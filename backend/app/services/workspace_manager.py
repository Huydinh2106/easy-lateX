from __future__ import annotations

import logging
import threading
import time
import uuid
from abc import ABC, abstractmethod

import docker
from docker.errors import APIError, DockerException, ImageNotFound, NotFound
from docker.models.containers import Container

from app.config import Settings


logger = logging.getLogger(__name__)

MANAGED_LABEL = "com.easy-latex.managed"
PROJECT_LABEL = "com.easy-latex.project-id"
PURPOSE_LABEL = "com.easy-latex.purpose"


class WorkspaceError(RuntimeError):
    """Base class for curated workspace errors safe to return to API clients."""


class DockerUnavailableError(WorkspaceError):
    pass


class WorkspaceImageMissingError(WorkspaceError):
    pass


class WorkspaceConflictError(WorkspaceError):
    pass


class WorkspaceStartError(WorkspaceError):
    pass


class NoFreeWorkspacePortError(WorkspaceError):
    pass


class WorkspaceManager(ABC):
    @abstractmethod
    def create_workspace(self, project_id: uuid.UUID) -> str:
        raise NotImplementedError

    @abstractmethod
    def start_workspace(self, project_id: uuid.UUID) -> tuple[str, str]:
        raise NotImplementedError

    @abstractmethod
    def stop_workspace(self, project_id: uuid.UUID) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_workspace_status(self, project_id: uuid.UUID) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_workspace_url(self, project_id: uuid.UUID) -> str | None:
        raise NotImplementedError

    @abstractmethod
    def delete_workspace(self, project_id: uuid.UUID) -> None:
        raise NotImplementedError

    @abstractmethod
    def is_available(self) -> bool:
        raise NotImplementedError

    def stop_all_workspaces(self) -> None:
        return None


class DockerWorkspaceManager(WorkspaceManager):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._docker_client: docker.DockerClient | None = None
        self._lock = threading.RLock()

    @property
    def client(self) -> docker.DockerClient:
        if self._docker_client is None:
            try:
                self._docker_client = docker.from_env(timeout=10)
                self._docker_client.ping()
            except DockerException as exc:
                self._docker_client = None
                raise DockerUnavailableError("Docker is unavailable to the workspace manager") from exc
        return self._docker_client

    def is_available(self) -> bool:
        try:
            self.client.ping()
            return True
        except DockerException:
            self._docker_client = None
            return False
        except WorkspaceError:
            return False

    def create_workspace(self, project_id: uuid.UUID) -> str:
        volume_name = self._volume_name(project_id)
        init_container: Container | None = None
        created_volume = False
        initialized = False

        with self._lock:
            try:
                try:
                    self.client.volumes.get(volume_name)
                except NotFound:
                    self.client.volumes.create(
                        name=volume_name,
                        labels={
                            MANAGED_LABEL: "true",
                            PROJECT_LABEL: str(project_id),
                            PURPOSE_LABEL: "project-files",
                        },
                    )
                    created_volume = True
                else:
                    raise WorkspaceConflictError("A workspace already exists for this project")

                init_container = self.client.containers.run(
                    self.settings.workspace_image,
                    name=f"{self._container_name(project_id)}-init",
                    entrypoint="/usr/local/bin/init-latex-project",
                    command=[],
                    user="0:0",
                    volumes={
                        volume_name: {"bind": "/home/coder/project", "mode": "rw"}
                    },
                    labels={
                        MANAGED_LABEL: "true",
                        PROJECT_LABEL: str(project_id),
                        PURPOSE_LABEL: "project-initializer",
                    },
                    network_disabled=True,
                    detach=True,
                )
                result = init_container.wait(timeout=60)
                if result.get("StatusCode") != 0:
                    logs = init_container.logs(tail=100).decode("utf-8", errors="replace")
                    logger.error("Project initializer failed for %s: %s", project_id, logs)
                    raise WorkspaceError("The project template could not be initialized")
                initialized = True
                return volume_name
            except ImageNotFound as exc:
                raise WorkspaceImageMissingError(
                    f"Workspace image '{self.settings.workspace_image}' is not available"
                ) from exc
            except APIError as exc:
                logger.exception("Docker failed while creating workspace %s", project_id)
                raise WorkspaceError("Docker could not create the project workspace") from exc
            finally:
                if init_container is not None:
                    try:
                        init_container.remove(force=True)
                    except DockerException:
                        logger.warning("Could not remove initializer container for %s", project_id)
                if created_volume and not initialized:
                    try:
                        self.client.volumes.get(volume_name).remove(force=True)
                    except DockerException:
                        logger.warning("Could not clean failed project volume %s", volume_name)

    def start_workspace(self, project_id: uuid.UUID) -> tuple[str, str]:
        with self._lock:
            self._assert_project_volume(project_id)
            container_name = self._container_name(project_id)
            try:
                container = self.client.containers.get(container_name)
                self._validate_container(container, project_id)
                container.reload()
                if container.status != "running":
                    container.start()
            except NotFound:
                port = self._allocate_port()
                try:
                    container = self.client.containers.create(
                        self.settings.workspace_image,
                        name=container_name,
                        environment={"PASSWORD": self.settings.code_server_password},
                        volumes={
                            self._volume_name(project_id): {
                                "bind": "/home/coder/project",
                                "mode": "rw",
                            }
                        },
                        ports={"8080/tcp": (self.settings.workspace_bind_host, port)},
                        labels={
                            MANAGED_LABEL: "true",
                            PROJECT_LABEL: str(project_id),
                            PURPOSE_LABEL: "project-editor",
                        },
                        restart_policy={"Name": "unless-stopped"},
                    )
                    container.start()
                except ImageNotFound as exc:
                    raise WorkspaceImageMissingError(
                        f"Workspace image '{self.settings.workspace_image}' is not available"
                    ) from exc
                except APIError as exc:
                    logger.exception("Docker failed while starting workspace %s", project_id)
                    raise WorkspaceStartError(
                        "Docker could not start the project workspace; verify the port range"
                    ) from exc
            except APIError as exc:
                logger.exception("Docker failed while reusing workspace %s", project_id)
                raise WorkspaceStartError("Docker could not restart the project workspace") from exc

            self._wait_until_ready(container, project_id)
            url = self._url_for_container(container)
            return "running", url

    def stop_workspace(self, project_id: uuid.UUID) -> str:
        with self._lock:
            try:
                container = self.client.containers.get(self._container_name(project_id))
                self._validate_container(container, project_id)
                container.reload()
                if container.status == "running":
                    container.stop(timeout=10)
            except NotFound:
                pass
            except APIError as exc:
                raise WorkspaceError("Docker could not stop the project workspace") from exc
        return "stopped"

    def get_workspace_status(self, project_id: uuid.UUID) -> str:
        try:
            container = self.client.containers.get(self._container_name(project_id))
            self._validate_container(container, project_id)
            container.reload()
        except NotFound:
            return "stopped"
        except APIError as exc:
            raise WorkspaceError("Docker could not inspect the project workspace") from exc

        if container.status == "running":
            health = container.attrs.get("State", {}).get("Health", {}).get("Status")
            return "running" if health in (None, "healthy") else "starting"
        if container.status in {"created", "exited", "dead"}:
            return "stopped"
        return container.status

    def get_workspace_url(self, project_id: uuid.UUID) -> str | None:
        try:
            container = self.client.containers.get(self._container_name(project_id))
            self._validate_container(container, project_id)
            container.reload()
        except NotFound:
            return None
        except APIError as exc:
            raise WorkspaceError("Docker could not inspect the project workspace") from exc

        if container.status != "running":
            return None
        return self._url_for_container(container)

    def delete_workspace(self, project_id: uuid.UUID) -> None:
        with self._lock:
            try:
                container = self.client.containers.get(self._container_name(project_id))
                self._validate_container(container, project_id)
                container.remove(force=True)
            except NotFound:
                pass
            except APIError as exc:
                raise WorkspaceError("Docker could not remove the project editor") from exc

            try:
                volume = self.client.volumes.get(self._volume_name(project_id))
                self._validate_volume(volume.attrs.get("Labels") or {}, project_id)
                volume.remove(force=False)
            except NotFound:
                pass
            except APIError as exc:
                raise WorkspaceError("Docker could not remove the project files") from exc

    def stop_all_workspaces(self) -> None:
        if not self.is_available():
            return
        try:
            containers = self.client.containers.list(
                all=True,
                filters={"label": [f"{MANAGED_LABEL}=true", f"{PURPOSE_LABEL}=project-editor"]},
            )
            for container in containers:
                container.reload()
                if container.status == "running":
                    container.stop(timeout=10)
        except DockerException:
            logger.exception("Could not stop all managed workspaces during shutdown")

    def _allocate_port(self) -> int:
        used_ports: set[int] = set()
        containers = self.client.containers.list(
            all=True,
            filters={"label": [f"{MANAGED_LABEL}=true", f"{PURPOSE_LABEL}=project-editor"]},
        )
        for container in containers:
            bindings = container.attrs.get("HostConfig", {}).get("PortBindings", {})
            for binding in bindings.get("8080/tcp") or []:
                host_port = binding.get("HostPort")
                if host_port:
                    used_ports.add(int(host_port))

        for port in range(self.settings.workspace_port_start, self.settings.workspace_port_end + 1):
            if port not in used_ports:
                return port
        raise NoFreeWorkspacePortError("No free code-server port is available")

    def _wait_until_ready(self, container: Container, project_id: uuid.UUID) -> None:
        deadline = time.monotonic() + self.settings.workspace_start_timeout_seconds
        while time.monotonic() < deadline:
            container.reload()
            state = container.attrs.get("State", {})
            health = state.get("Health", {}).get("Status")
            if container.status == "running" and health in (None, "healthy"):
                return
            if container.status in {"exited", "dead"} or health == "unhealthy":
                logger.error("Workspace %s entered state %s/%s", project_id, container.status, health)
                raise WorkspaceStartError("The project editor failed its startup healthcheck")
            time.sleep(0.5)
        raise WorkspaceStartError("Timed out while waiting for the project editor")

    def _url_for_container(self, container: Container) -> str:
        bindings = container.attrs.get("NetworkSettings", {}).get("Ports", {}).get("8080/tcp")
        if not bindings:
            raise WorkspaceStartError("The project editor has no published port")
        port = bindings[0]["HostPort"]
        return f"http://{self.settings.workspace_public_host}:{port}"

    def _assert_project_volume(self, project_id: uuid.UUID) -> None:
        try:
            volume = self.client.volumes.get(self._volume_name(project_id))
            labels = volume.attrs.get("Labels") or {}
            self._validate_volume(labels, project_id)
        except NotFound as exc:
            raise WorkspaceError("The project workspace files are missing") from exc
        except APIError as exc:
            raise WorkspaceError("Docker could not inspect the project files") from exc

    def _validate_container(self, container: Container, project_id: uuid.UUID) -> None:
        labels = container.labels or {}
        if labels.get(MANAGED_LABEL) != "true" or labels.get(PROJECT_LABEL) != str(project_id):
            raise WorkspaceConflictError("The expected workspace container name is already in use")

    def _validate_volume(self, labels: dict[str, str], project_id: uuid.UUID) -> None:
        if labels.get(MANAGED_LABEL) != "true" or labels.get(PROJECT_LABEL) != str(project_id):
            raise WorkspaceConflictError("The expected project volume name is already in use")

    def _volume_name(self, project_id: uuid.UUID) -> str:
        return f"{self.settings.workspace_volume_prefix}-{project_id}"

    def _container_name(self, project_id: uuid.UUID) -> str:
        return f"{self.settings.workspace_container_prefix}-{project_id}"

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.services.workspace_manager import WorkspaceManager


class FakeWorkspaceManager(WorkspaceManager):
    def __init__(self) -> None:
        self.workspaces: dict[uuid.UUID, str] = {}
        self.start_counts: dict[uuid.UUID, int] = {}

    def create_workspace(self, project_id: uuid.UUID) -> str:
        self.workspaces[project_id] = "stopped"
        return f"test-project-{project_id}"

    def start_workspace(self, project_id: uuid.UUID) -> tuple[str, str]:
        self.workspaces[project_id] = "running"
        self.start_counts[project_id] = self.start_counts.get(project_id, 0) + 1
        return "running", f"http://localhost:{8100 + len(self.workspaces)}"

    def stop_workspace(self, project_id: uuid.UUID) -> str:
        self.workspaces[project_id] = "stopped"
        return "stopped"

    def get_workspace_status(self, project_id: uuid.UUID) -> str:
        return self.workspaces.get(project_id, "stopped")

    def get_workspace_url(self, project_id: uuid.UUID) -> str | None:
        if self.workspaces.get(project_id) != "running":
            return None
        return f"http://localhost:{8100 + len(self.workspaces)}"

    def delete_workspace(self, project_id: uuid.UUID) -> None:
        self.workspaces.pop(project_id, None)

    def is_available(self) -> bool:
        return True


def test_project_crud_and_workspace_flow() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(engine)
    manager = FakeWorkspaceManager()
    app = create_app(manager)

    def override_db() -> Session:
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db

    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"

        created = client.post("/projects", json={"name": "  Thesis Test  "})
        assert created.status_code == 201
        project = created.json()
        assert project["name"] == "Thesis Test"
        project_id = project["id"]

        listed = client.get("/projects")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()] == [project_id]

        first_open = client.post(f"/projects/{project_id}/open")
        second_open = client.post(f"/projects/{project_id}/open")
        assert first_open.status_code == second_open.status_code == 200
        assert first_open.json()["workspace_url"] == second_open.json()["workspace_url"]
        assert len(manager.workspaces) == 1

        details = client.get(f"/projects/{project_id}/workspace")
        assert details.json()["status"] == "running"

        deleted = client.delete(f"/projects/{project_id}")
        assert deleted.status_code == 204
        assert client.get("/projects").json() == []
        assert uuid.UUID(project_id) not in manager.workspaces


def test_project_name_validation() -> None:
    manager = FakeWorkspaceManager()
    app = create_app(manager)
    with TestClient(app) as client:
        response = client.post("/projects", json={"name": "   "})
        assert response.status_code == 422

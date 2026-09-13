import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_current_user
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.user import User
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
    owner = User(id=uuid.uuid4(), firebase_uid="owner-uid", email="owner@example.com")
    collaborator = User(
        id=uuid.uuid4(), firebase_uid="collaborator-uid", email="collaborator@example.com"
    )
    with testing_session() as db:
        db.add_all([owner, collaborator])
        db.commit()
    active_user = {"value": owner}

    def override_db() -> Session:
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: active_user["value"]

    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"

        created = client.post("/projects", json={"name": "  Thesis Test  "})
        assert created.status_code == 201
        project = created.json()
        assert project["name"] == "Thesis Test"
        assert project["owner_id"] == str(owner.id)
        project_id = project["id"]

        listed = client.get("/projects")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()] == [project_id]

        active_user["value"] = collaborator
        assert client.get("/projects").json() == []
        assert client.get(f"/projects/{project_id}").status_code == 404
        assert client.post(f"/projects/{project_id}/open").status_code == 404
        assert client.delete(f"/projects/{project_id}").status_code == 404

        active_user["value"] = owner

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
    app.dependency_overrides[get_current_user] = lambda: User(
        id=uuid.uuid4(), firebase_uid="test-user"
    )
    with TestClient(app) as client:
        response = client.post("/projects", json={"name": "   "})
        assert response.status_code == 422


def test_firebase_claims_create_user_and_protect_projects(monkeypatch) -> None:
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

    monkeypatch.setattr(
        "app.api.dependencies.verify_firebase_token",
        lambda token: {
            "uid": "firebase-user-1",
            "email": "writer@example.com",
            "email_verified": True,
            "name": "Test Writer",
            "firebase": {"sign_in_provider": "google.com"},
        },
    )
    app.dependency_overrides[get_db] = override_db

    with TestClient(app) as client:
        assert client.get("/projects").status_code == 401

        response = client.post(
            "/projects",
            headers={"Authorization": "Bearer valid-test-token"},
            json={"name": "Authenticated project"},
        )
        assert response.status_code == 201

    with testing_session() as db:
        user = db.scalar(select(User).where(User.firebase_uid == "firebase-user-1"))
        assert user is not None
        assert user.email == "writer@example.com"
        assert user.email_verified is True
        assert user.display_name == "Test Writer"
        assert user.auth_provider == "google.com"
        assert response.json()["owner_id"] == str(user.id)

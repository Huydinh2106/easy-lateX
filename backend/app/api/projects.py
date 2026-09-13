import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_workspace_manager
from app.db.session import get_db
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectRead, WorkspaceRead
from app.services.project_service import ProjectNotFoundError, ProjectService
from app.services.workspace_manager import WorkspaceError, WorkspaceManager


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["projects"])

DbSession = Annotated[Session, Depends(get_db)]
Manager = Annotated[WorkspaceManager, Depends(get_workspace_manager)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _service(manager: WorkspaceManager) -> ProjectService:
    return ProjectService(manager)


def _not_found(exc: ProjectNotFoundError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


def _workspace_failure(exc: WorkspaceError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))


@router.get("", response_model=list[ProjectRead])
def list_projects(db: DbSession, manager: Manager, current_user: CurrentUser) -> list[ProjectRead]:
    try:
        return _service(manager).list_projects(db, current_user.id)
    except SQLAlchemyError as exc:
        logger.exception("Database error while listing projects")
        raise HTTPException(status_code=503, detail="The project database is unavailable") from exc


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate, db: DbSession, manager: Manager, current_user: CurrentUser
) -> ProjectRead:
    try:
        return _service(manager).create_project(db, payload.name, current_user.id)
    except WorkspaceError as exc:
        raise _workspace_failure(exc) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error while creating project")
        raise HTTPException(status_code=503, detail="The project could not be saved") from exc


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(
    project_id: uuid.UUID, db: DbSession, manager: Manager, current_user: CurrentUser
) -> ProjectRead:
    try:
        return _service(manager).get_project(db, project_id, current_user.id)
    except ProjectNotFoundError as exc:
        raise _not_found(exc) from exc


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: uuid.UUID, db: DbSession, manager: Manager, current_user: CurrentUser
) -> Response:
    try:
        _service(manager).delete_project(db, project_id, current_user.id)
    except ProjectNotFoundError as exc:
        raise _not_found(exc) from exc
    except WorkspaceError as exc:
        raise _workspace_failure(exc) from exc
    except SQLAlchemyError as exc:
        logger.exception("Database error while deleting project")
        raise HTTPException(status_code=503, detail="The project could not be deleted") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/open", response_model=WorkspaceRead)
def open_project(
    project_id: uuid.UUID, db: DbSession, manager: Manager, current_user: CurrentUser
) -> WorkspaceRead:
    try:
        project, url = _service(manager).open_project(db, project_id, current_user.id)
        return WorkspaceRead(project_id=project.id, status=project.workspace_status, workspace_url=url)
    except ProjectNotFoundError as exc:
        raise _not_found(exc) from exc
    except WorkspaceError as exc:
        raise _workspace_failure(exc) from exc


@router.get("/{project_id}/workspace", response_model=WorkspaceRead)
def get_workspace(
    project_id: uuid.UUID, db: DbSession, manager: Manager, current_user: CurrentUser
) -> WorkspaceRead:
    try:
        status_value, url = _service(manager).workspace_details(db, project_id, current_user.id)
        return WorkspaceRead(project_id=project_id, status=status_value, workspace_url=url)
    except ProjectNotFoundError as exc:
        raise _not_found(exc) from exc
    except WorkspaceError as exc:
        raise _workspace_failure(exc) from exc


@router.post("/{project_id}/stop", response_model=WorkspaceRead)
def stop_project(
    project_id: uuid.UUID, db: DbSession, manager: Manager, current_user: CurrentUser
) -> WorkspaceRead:
    try:
        project = _service(manager).stop_project(db, project_id, current_user.id)
        return WorkspaceRead(project_id=project.id, status=project.workspace_status)
    except ProjectNotFoundError as exc:
        raise _not_found(exc) from exc
    except WorkspaceError as exc:
        raise _workspace_failure(exc) from exc

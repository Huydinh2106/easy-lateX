from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.project import Project
from app.services.workspace_manager import WorkspaceError, WorkspaceManager


logger = logging.getLogger(__name__)


class ProjectNotFoundError(LookupError):
    pass


class ProjectService:
    def __init__(self, workspace_manager: WorkspaceManager) -> None:
        self.workspace_manager = workspace_manager

    def list_projects(self, db: Session) -> list[Project]:
        projects = list(db.scalars(select(Project).order_by(Project.created_at.desc())))
        changed = False
        for project in projects:
            try:
                status = self.workspace_manager.get_workspace_status(project.id)
            except WorkspaceError:
                logger.warning("Could not refresh workspace status for project %s", project.id)
                continue
            if project.workspace_status != status:
                project.workspace_status = status
                changed = True
        if changed:
            db.commit()
        return projects

    def get_project(self, db: Session, project_id: uuid.UUID) -> Project:
        project = db.get(Project, project_id)
        if project is None:
            raise ProjectNotFoundError(f"Project {project_id} was not found")
        return project

    def create_project(self, db: Session, name: str) -> Project:
        project_id = uuid.uuid4()
        project = Project(
            id=project_id,
            name=name,
            workspace_status="stopped",
            workspace_identifier=f"pending-{project_id}",
        )
        workspace_created = False

        try:
            db.add(project)
            db.flush()
            project.workspace_identifier = self.workspace_manager.create_workspace(project_id)
            workspace_created = True
            db.commit()
            db.refresh(project)
            return project
        except Exception:
            db.rollback()
            if workspace_created:
                try:
                    self.workspace_manager.delete_workspace(project_id)
                except WorkspaceError:
                    logger.exception("Could not clean workspace after project creation failed")
            raise

    def open_project(self, db: Session, project_id: uuid.UUID) -> tuple[Project, str]:
        project = self.get_project(db, project_id)
        status, url = self.workspace_manager.start_workspace(project_id)
        project.workspace_status = status
        db.commit()
        db.refresh(project)
        return project, url

    def workspace_details(self, db: Session, project_id: uuid.UUID) -> tuple[str, str | None]:
        project = self.get_project(db, project_id)
        status = self.workspace_manager.get_workspace_status(project_id)
        url = self.workspace_manager.get_workspace_url(project_id)
        if project.workspace_status != status:
            project.workspace_status = status
            db.commit()
        return status, url

    def stop_project(self, db: Session, project_id: uuid.UUID) -> Project:
        project = self.get_project(db, project_id)
        project.workspace_status = self.workspace_manager.stop_workspace(project_id)
        db.commit()
        db.refresh(project)
        return project

    def delete_project(self, db: Session, project_id: uuid.UUID) -> None:
        project = self.get_project(db, project_id)
        self.workspace_manager.delete_workspace(project_id)
        db.delete(project)
        db.commit()

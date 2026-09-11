import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.dependencies import get_workspace_manager
from app.api.projects import router as projects_router
from app.config import get_settings
from app.db.session import get_db
from app.services.workspace_manager import DockerWorkspaceManager, WorkspaceManager


def create_app(workspace_manager: WorkspaceManager | None = None) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.workspace_manager = workspace_manager or DockerWorkspaceManager(settings)
        yield
        await asyncio.to_thread(application.state.workspace_manager.stop_all_workspaces)

    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Local project and workspace management for Easy LaTeX.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    application.include_router(projects_router)

    @application.get("/", tags=["system"])
    def root() -> dict[str, str]:
        return {"name": settings.app_name, "docs": "/docs"}

    @application.get("/health", tags=["system"])
    def health(
        db: Session = Depends(get_db),
        manager: WorkspaceManager = Depends(get_workspace_manager),
    ) -> dict[str, str]:
        try:
            db.execute(text("SELECT 1"))
        except SQLAlchemyError as exc:
            raise HTTPException(status_code=503, detail="PostgreSQL is unavailable") from exc
        if not manager.is_available():
            raise HTTPException(status_code=503, detail="Docker is unavailable")
        return {"status": "ok", "database": "ok", "docker": "ok"}

    return application


app = create_app()

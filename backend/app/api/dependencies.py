from fastapi import Request

from app.services.workspace_manager import WorkspaceManager


def get_workspace_manager(request: Request) -> WorkspaceManager:
    return request.app.state.workspace_manager

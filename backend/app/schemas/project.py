import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Project name cannot be blank")
        if re.search(r"[\x00-\x1f\x7f]", cleaned):
            raise ValueError("Project name cannot contain control characters")
        return cleaned


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    created_at: datetime
    updated_at: datetime
    workspace_status: str
    workspace_identifier: str


class WorkspaceRead(BaseModel):
    project_id: uuid.UUID
    status: str
    workspace_url: str | None = None

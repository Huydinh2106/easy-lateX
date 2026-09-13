from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Easy LaTeX API"
    postgres_user: str = "latex"
    postgres_password: str = ""
    postgres_db: str = "latex_platform"
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    database_url: str | None = None

    cors_origins: str = "http://localhost:3000"

    firebase_project_id: str = ""
    firebase_credentials_json: SecretStr | None = None
    firebase_credentials_path: str = ""

    workspace_image: str = "latex-workspace:local"
    workspace_volume_prefix: str = "easy-latex-project"
    workspace_container_prefix: str = "easy-latex-workspace"
    workspace_bind_host: str = "127.0.0.1"
    workspace_public_host: str = "localhost"
    workspace_port_start: int = 8100
    workspace_port_end: int = 8199
    workspace_start_timeout_seconds: int = 45
    code_server_password: str = ""

    @property
    def sqlalchemy_url(self) -> URL:
        if self.database_url:
            return make_url(self.database_url)

        return URL.create(
            "postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

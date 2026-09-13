from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

import firebase_admin
from firebase_admin import auth, credentials

from app.config import get_settings


class FirebaseConfigurationError(RuntimeError):
    pass


class InvalidFirebaseTokenError(ValueError):
    pass


class FirebaseVerificationError(RuntimeError):
    pass


@lru_cache
def get_firebase_app() -> firebase_admin.App:
    settings = get_settings()
    project_id = settings.firebase_project_id.strip()
    credential = None

    credentials_json = (
        settings.firebase_credentials_json.get_secret_value().strip()
        if settings.firebase_credentials_json
        else ""
    )
    if credentials_json:
        try:
            credential_payload = json.loads(credentials_json)
            credential = credentials.Certificate(credential_payload)
            project_id = project_id or str(credential_payload.get("project_id", ""))
        except (TypeError, ValueError, KeyError) as exc:
            raise FirebaseConfigurationError("Firebase service account configuration is invalid") from exc
    elif settings.firebase_credentials_path.strip():
        try:
            credential = credentials.Certificate(settings.firebase_credentials_path.strip())
            project_id = project_id or credential.project_id or ""
        except (OSError, ValueError) as exc:
            raise FirebaseConfigurationError("Firebase service account file is invalid") from exc

    if not project_id:
        raise FirebaseConfigurationError("FIREBASE_PROJECT_ID is required")

    try:
        return firebase_admin.get_app()
    except ValueError:
        options = {"projectId": project_id}
        return firebase_admin.initialize_app(credential, options)


def verify_firebase_token(id_token: str) -> dict[str, Any]:
    try:
        return auth.verify_id_token(id_token, app=get_firebase_app())
    except FirebaseConfigurationError:
        raise
    except (
        auth.ExpiredIdTokenError,
        auth.InvalidIdTokenError,
        auth.RevokedIdTokenError,
        auth.UserDisabledError,
        ValueError,
    ) as exc:
        raise InvalidFirebaseTokenError("Firebase ID token is invalid") from exc
    except Exception as exc:
        raise FirebaseVerificationError("Firebase could not verify the ID token") from exc

from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.firebase import (
    FirebaseConfigurationError,
    FirebaseVerificationError,
    InvalidFirebaseTokenError,
    verify_firebase_token,
)
from app.db.session import get_db
from app.models.user import User
from app.services.workspace_manager import WorkspaceManager


def get_workspace_manager(request: Request) -> WorkspaceManager:
    return request.app.state.workspace_manager


def _claim(claims: dict[str, Any], key: str, max_length: int) -> str | None:
    value = claims.get(key)
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:max_length]


def _upsert_user(db: Session, claims: dict[str, Any]) -> User:
    uid = _claim(claims, "uid", 128)
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")

    firebase_claims = claims.get("firebase")
    provider = None
    if isinstance(firebase_claims, dict):
        raw_provider = firebase_claims.get("sign_in_provider")
        if isinstance(raw_provider, str):
            provider = raw_provider[:64]

    profile = {
        "email": _claim(claims, "email", 320),
        "email_verified": bool(claims.get("email_verified", False)),
        "display_name": _claim(claims, "name", 128),
        "photo_url": _claim(claims, "picture", 2048),
        "auth_provider": provider,
    }
    user = db.scalar(select(User).where(User.firebase_uid == uid))
    if user is None:
        user = User(firebase_uid=uid, **profile)
        db.add(user)
    else:
        for key, value in profile.items():
            setattr(user, key, value)

    try:
        db.commit()
        db.refresh(user)
        return user
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(User).where(User.firebase_uid == uid))
        if existing is not None:
            return existing
        raise


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = verify_firebase_token(token)
        return _upsert_user(db, claims)
    except InvalidFirebaseTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session is invalid or expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except FirebaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured",
        ) from exc
    except FirebaseVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is temporarily unavailable",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The user database is unavailable",
        ) from exc

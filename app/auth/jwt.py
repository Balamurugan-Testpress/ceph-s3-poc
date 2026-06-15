"""JWT token creation and verification."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

import jwt

from app.config import settings

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = settings.jwt_expire_hours

# Use the configured secret, or generate a random one at startup.
_SECRET_KEY = (
    settings.jwt_secret
    if settings.jwt_secret != "change-me-to-a-random-secret"
    else secrets.token_urlsafe(32)
)


def create_access_token(
    user_id: str,
    username: str = "admin",
    role: str = "admin",
    display_name: str = "Administrator",
) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "display_name": display_name,
        "exp": datetime.now(UTC) + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, _SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """Decode and verify a JWT. Returns the payload dict or None on failure."""
    try:
        return jwt.decode(token, _SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None

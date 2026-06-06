"""JWT token creation and verification."""

from __future__ import annotations

import os
import secrets
from datetime import UTC, datetime, timedelta

import jwt

SECRET_KEY = os.getenv("JWT_SECRET") or secrets.token_urlsafe(32)
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))


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
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """Decode and verify a JWT. Returns the payload dict or None on failure."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None

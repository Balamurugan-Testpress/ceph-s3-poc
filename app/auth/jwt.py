"""JWT token creation."""

import os
import secrets
from datetime import UTC, datetime, timedelta

import jwt

SECRET_KEY = os.getenv("JWT_SECRET") or secrets.token_urlsafe(32)
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))


def create_access_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "username": os.getenv("ADMIN_USERNAME", "admin"),
        "role": "admin",
        "display_name": "Administrator",
        "exp": datetime.now(UTC) + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

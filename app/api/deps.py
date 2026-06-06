"""FastAPI dependency for JWT authentication.

Decodes the Bearer token and returns the user info from the JWT payload.
No database calls.
"""

from __future__ import annotations

import os

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.jwt import ALGORITHM

_security = HTTPBearer(auto_error=False)
_JWT_SECRET = os.getenv("JWT_SECRET", "")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    from app.auth.jwt import SECRET_KEY as _FALLBACK_SECRET
    secret = _JWT_SECRET or _FALLBACK_SECRET

    try:
        payload = jwt.decode(credentials.credentials, secret, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    return {
        "id": payload.get("sub", ""),
        "username": payload.get("username", ""),
        "role": payload.get("role", "admin"),
        "display_name": payload.get("display_name", "Administrator"),
    }


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

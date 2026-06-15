"""FastAPI dependencies for auth and DB sessions."""

from __future__ import annotations

import uuid

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import decode_access_token
from app.db import get_db
from app.services.user_service import get_user_by_id

ADMIN_ID = "admin"


async def get_current_user(
    authorization: str = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Decode JWT and return the authenticated user.

    For the admin user (id == "admin"), returns a virtual user dict.
    For DB-backed users, fetches their record (including RGW keys).
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.replace("Bearer ", "")

    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # ── Admin virtual user (not in DB) ──
    if user_id == ADMIN_ID:
        return {
            "id": ADMIN_ID,
            "username": payload.get("username", "admin"),
            "role": "admin",
            "display_name": payload.get("display_name", "Administrator"),
            "quota_bytes": 0,
            "used_bytes": 0,
            "rgw_user_id": ADMIN_ID,
            "rgw_access_key": None,  # will use env var
            "rgw_secret_key": None,  # will use env var
        }

    # ── DB-backed tenant user ──
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid user ID in token")

    user = await get_user_by_id(db, uid)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    return {
        "id": str(user.id),
        "username": user.username,
        "role": user.role,
        "display_name": user.display_name or user.username,
        "quota_bytes": user.quota_bytes,
        "used_bytes": user.used_bytes,
        "rgw_user_id": user.rgw_user_id,
        "rgw_access_key": user.rgw_access_key,
        "rgw_secret_key": user.rgw_secret_key,
    }


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Require the authenticated user to be an admin."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

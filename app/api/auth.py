"""Authentication — admin via env vars, tenants via DB."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.auth.jwt import create_access_token
from app.config import settings
from app.db import get_db
from app.db.models import User
from app.db.schemas import LoginRequest, LoginResponse, UserOut
from app.services.user_service import get_user_by_username

logger = logging.getLogger("ceph-s3-poc")

router = APIRouter(prefix="/auth", tags=["auth"])


async def _ensure_rgw_user_exists(
    db: AsyncSession,
    user: User,
) -> None:
    """Recreate the RGW user if it is missing from Ceph.

    This handles the case where the RGW data was reset but the app
    database still has a stale user record with now-invalid credentials.
    """
    if not user.rgw_user_id:
        return

    from app.services.rgw_admin import create_rgw_user, extract_rgw_keys, get_rgw_user
    from app.services.user_service import update_rgw_creds

    try:
        rgw_user = await get_rgw_user(user.rgw_user_id)
        if rgw_user is not None:
            return  # RGW user exists — nothing to do

        logger.info(
            "RGW user %s not found in Ceph — recreating with auto-heal",
            user.rgw_user_id,
        )
        rgw_resp = await create_rgw_user(
            uid=user.rgw_user_id,
            display_name=user.display_name or user.username,
        )
        keys = extract_rgw_keys(rgw_resp)
        if keys:
            ak, sk = keys
            updated = await update_rgw_creds(db, user.id, user.rgw_user_id, ak, sk)
            if updated:
                # Update the caller's user object so they see the new keys
                user.rgw_access_key = ak
                user.rgw_secret_key = sk
                logger.info(
                    "Auto-heal recreated RGW user %s with new keys",
                    user.rgw_user_id,
                )
    except Exception as exc:
        logger.warning(
            "Auto-heal for RGW user %s failed: %s",
            user.rgw_user_id if user else "(unknown)",
            exc,
        )


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    admin_user = settings.admin_username
    admin_pass = settings.admin_password

    # 1. Check if this is the admin user (from env vars)
    if (
        admin_user
        and admin_pass
        and data.username == admin_user
        and data.password == admin_pass
    ):
        token = create_access_token(
            user_id="admin",
            username=admin_user,
            role="admin",
            display_name="Administrator",
        )
        return LoginResponse(
            access_token=token,
            user=UserOut(
                id="admin",
                username=admin_user,
                display_name="Administrator",
                role="admin",
                quota_bytes=0,
                used_bytes=0,
            ),
        )

    # 2. Otherwise check the database for a tenant user.
    #    All users share the same master password (admin password).
    user = await get_user_by_username(db, data.username)
    if not user or data.password != admin_pass:
        raise HTTPException(status_code=401, detail="Invalid Credentials")

    # Auto-heal: if the RGW user was wiped from Ceph (e.g. RGW data reset),
    # recreate it and update the stored credentials before the user proceeds.
    await _ensure_rgw_user_exists(db, user)

    token = create_access_token(
        user_id=str(user.id),
        username=user.username,
        role=user.role,
        display_name=user.display_name or user.username,
    )

    return LoginResponse(
        access_token=token,
        user=user,
    )


class CredentialsOut(BaseModel):
    access_key: str | None = None
    secret_key: str | None = None


@router.get("/credentials", response_model=CredentialsOut)
async def get_credentials(current_user: dict = Depends(get_current_user)):
    """Return the current user's RGW S3 credentials."""
    if current_user["role"] == "admin":
        return CredentialsOut()
    return CredentialsOut(
        access_key=current_user.get("rgw_access_key"),
        secret_key=current_user.get("rgw_secret_key"),
    )

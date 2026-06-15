"""Authentication — admin via env vars, tenants via DB."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.auth.jwt import create_access_token
from app.config import settings
from app.db import get_db
from app.db.schemas import LoginRequest, LoginResponse, UserOut
from app.services.user_service import get_user_by_username

router = APIRouter(prefix="/auth", tags=["auth"])


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

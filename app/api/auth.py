"""Authentication — admin via env vars, tenants via DB."""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import create_access_token
from app.db import get_db
from app.db.schemas import LoginRequest, LoginResponse, UserOut
from app.services.user_service import get_user_by_username, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    admin_user = os.getenv("ADMIN_USERNAME", "admin")
    admin_pass = os.getenv("ADMIN_PASSWORD", "admin")

    # 1. Check if this is the admin user (from env vars)
    if data.username == admin_user and data.password == admin_pass:
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

    # 2. Otherwise check the database for a tenant user
    user = await get_user_by_username(db, data.username)
    if not user or not verify_password(data.password, user.password_hash):
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

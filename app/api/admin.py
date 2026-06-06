"""Admin endpoints — manage users, provision RGW credentials."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db import get_db
from app.db.schemas import CreateUserRequest, UserCreatedResponse, UserOut
from app.services.rgw_admin import create_rgw_user, extract_rgw_keys
from app.services.user_service import (
    create_user,
    delete_user,
    get_user_by_username,
    list_users,
    update_rgw_creds,
)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
async def list_all_users(db: AsyncSession = Depends(get_db), admin: dict = Depends(require_admin)):
    return await list_users(db)


@router.post("/users", response_model=UserCreatedResponse)
async def create_new_user(data: CreateUserRequest, db: AsyncSession = Depends(get_db), admin: dict = Depends(require_admin)):
    # Check for duplicate username
    existing = await get_user_by_username(db, data.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    # 1. Create the user in our DB (without RGW creds yet)
    user = await create_user(
        db,
        username=data.username,
        password=data.password,
        display_name=data.display_name,
        quota_gb=data.quota_gb,
    )

    # 2. Provision an RGW user in Ceph
    try:
        rgw_uid = f"app-{data.username}-{user.id.hex[:8]}"
        rgw_resp = await create_rgw_user(
            uid=rgw_uid,
            display_name=data.display_name or data.username,
        )
    except Exception as exc:
        # Atomic: RGW failed → roll back the DB user
        await delete_user(db, user.id)
        raise HTTPException(
            status_code=502,
            detail=f"RGW user creation failed — user rolled back: {exc}",
        )

    # 3. Extract keys and store them
    keys = extract_rgw_keys(rgw_resp)
    if not keys:
        await delete_user(db, user.id)
        raise HTTPException(
            status_code=502,
            detail="RGW user created but no keys returned — user rolled back",
        )

    access_key, secret_key = keys
    user = await update_rgw_creds(db, user.id, rgw_uid, access_key, secret_key)
    return UserCreatedResponse(
        message="User created with RGW credentials",
        user=user,
        rgw_access_key=access_key,
        rgw_secret_key=secret_key,
    )


@router.delete("/users/{user_id}")
async def delete_existing_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db), admin: dict = Depends(require_admin)):
    # TODO: also delete RGW user via rgw_admin.delete_rgw_user()
    deleted = await delete_user(db, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}

"""Admin endpoints — manage users, provision RGW credentials."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db import get_db
from pydantic import BaseModel

from app.db.schemas import CreateUserRequest, UserCreatedResponse, UserOut
from app.services.rgw_admin import create_rgw_user, delete_rgw_user, extract_rgw_keys
from app.services.rgw_client import RGWClient
from app.services.user_service import (
    create_user,
    delete_user,
    get_user_by_id,
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
    existing = await get_user_by_username(db, data.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = await create_user(
        db,
        username=data.username,
        password=data.password,
        display_name=data.display_name,
        quota_mb=(data.user_quota_max_size_kb // 1024) if (data.user_quota_enabled and data.user_quota_max_size_kb > 0) else -1,
    )

    try:
        rgw_uid = data.username
        rgw_resp = await create_rgw_user(
            uid=rgw_uid,
            display_name=data.display_name or data.username,
        )
    except Exception as exc:
        await delete_user(db, user.id)
        raise HTTPException(
            status_code=502,
            detail=f"RGW user creation failed — user rolled back: {exc}",
        )

    keys = extract_rgw_keys(rgw_resp)
    if not keys:
        await delete_user(db, user.id)
        raise HTTPException(
            status_code=502,
            detail="RGW user created but no keys returned — user rolled back",
        )

    access_key, secret_key = keys
    user = await update_rgw_creds(db, user.id, rgw_uid, access_key, secret_key)

    # 4. Set quota in Ceph (native S3-level enforcement)
    try:
        from app.services.rgw_admin import set_rgw_quota, set_rgw_ratelimit

        if data.user_quota_enabled:
            await set_rgw_quota(
                rgw_uid,
                "user",
                True,
                data.user_quota_max_size_kb,
                data.user_quota_max_objects,
            )
        if data.bucket_quota_enabled:
            await set_rgw_quota(
                rgw_uid,
                "bucket",
                True,
                data.bucket_quota_max_size_kb,
                data.bucket_quota_max_objects,
            )
        if data.rate_limit_enabled:
            await set_rgw_ratelimit(
                rgw_uid,
                True,
                data.rate_limit_max_read_ops,
                data.rate_limit_max_write_ops,
                data.rate_limit_max_read_bytes,
                data.rate_limit_max_write_bytes,
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error setting advanced limits: {e}")

    return UserCreatedResponse(
        message="User created with RGW credentials",
        user=user,
        rgw_access_key=access_key,
        rgw_secret_key=secret_key,
    )


async def _delete_user_buckets(ak: str, sk: str) -> None:
    """Delete all objects and buckets owned by this S3 user."""
    client = RGWClient(access_key=ak, secret_key=sk)
    buckets = client.list_buckets()
    for b in buckets:
        name = b["name"]
        # Delete all objects in the bucket
        while True:
            objs = client.list_objects(name, max_keys=1000)
            for obj in objs["objects"]:
                client.delete_object(name, obj["key"])
            if not objs["is_truncated"]:
                break
        # Delete the bucket itself
        try:
            client.delete_bucket(name)
        except Exception:
            pass  # best-effort


@router.delete("/users/{user_id}")
async def delete_existing_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    errors = []

    # 1. Remove all their buckets via S3
    if user.rgw_access_key and user.rgw_secret_key:
        try:
            await _delete_user_buckets(user.rgw_access_key, user.rgw_secret_key)
        except Exception as exc:
            errors.append(f"bucket cleanup failed: {exc}")

    # 2. Delete the RGW user from Ceph
    if user.rgw_user_id:
        try:
            await delete_rgw_user(user.rgw_user_id)
        except Exception as exc:
            errors.append(f"RGW user deletion failed: {exc}")

    # 3. Delete from our DB
    await delete_user(db, user_id)

    if errors:
        return {
            "message": "User deleted from DB, but some cleanup failed",
            "warnings": errors,
        }
    return {"message": "User and all associated resources deleted"}


class BulkDeleteUsersRequest(BaseModel):
    user_ids: list[uuid.UUID]


class UpdateQuotaRequest(BaseModel):
    quota_mb: int


@router.post("/users/bulk-delete")
async def bulk_delete_users(
    data: BulkDeleteUsersRequest,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    results = []
    for uid in data.user_ids:
        try:
            user = await get_user_by_id(db, uid)
            if not user:
                results.append({"id": str(uid), "status": "not_found"})
                continue

            errors = []
            if user.rgw_access_key and user.rgw_secret_key:
                try:
                    await _delete_user_buckets(user.rgw_access_key, user.rgw_secret_key)
                except Exception as exc:
                    errors.append(f"bucket cleanup failed: {exc}")

            if user.rgw_user_id:
                try:
                    await delete_rgw_user(user.rgw_user_id)
                except Exception as exc:
                    errors.append(f"RGW user deletion failed: {exc}")

            await delete_user(db, uid)
            results.append(
                {
                    "id": str(uid),
                    "status": "deleted",
                    "warnings": errors if errors else None,
                }
            )
        except Exception as exc:
            results.append({"id": str(uid), "status": "error", "detail": str(exc)})

    return {"results": results}


@router.patch("/users/{user_id}/quota")
async def update_quota(
    user_id: uuid.UUID,
    data: UpdateQuotaRequest,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.quota_bytes = data.quota_mb * 1_048_576
    await db.commit()

    # Sync quota to Ceph (native S3-level enforcement)
    if user.rgw_user_id:
        try:
            from app.services.rgw_admin import set_rgw_quota

            await set_rgw_quota(
                user.rgw_user_id, "user", True, data.quota_mb * 1024, -1
            )
        except Exception:
            pass  # non-critical

    return {"message": f"Quota updated to {data.quota_mb} MB"}

"""Admin endpoints — manage users, provision RGW credentials."""

from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.config import settings
from app.db import get_db
from app.db.models import User
from pydantic import BaseModel

from app.db.schemas import CreateUserRequest, UserCreatedResponse, UserOut, AuditLogOut
from app.services.audit_service import get_audit_logs, log_action
from app.services.rgw_admin import (
    create_rgw_user,
    delete_rgw_user,
    extract_rgw_keys,
    get_rgw_user,
    list_rgw_users,
    list_rgw_buckets,
    set_rgw_quota,
    set_rgw_ratelimit,
)
from app.services.rgw_client import RGWClient
from app.services.user_service import (
    create_user,
    delete_user,
    get_user_by_id,
    get_user_by_username,
    list_users,
    recalculate_usage,
    update_rgw_creds,
)

logger = logging.getLogger("ceph-s3-poc")

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
async def list_all_users(db: AsyncSession = Depends(get_db), admin: dict = Depends(require_admin)):
    users = await list_users(db)
    result = []

    # Fetch all buckets once to count them and sum usage by owner in one API call
    bucket_counts: dict[str, int] = {}
    user_usage: dict[str, int] = {}
    try:
        all_buckets = await list_rgw_buckets()
        for b in all_buckets:
            owner = b.get("owner")
            if owner:
                bucket_counts[owner] = bucket_counts.get(owner, 0) + 1
                usage_stats = b.get("usage", {}).get("rgw.main", {})
                b_used = usage_stats.get("size_actual", usage_stats.get("size", usage_stats.get("size_kb", 0) * 1024))
                user_usage[owner] = user_usage.get(owner, 0) + b_used
    except Exception as exc:
        logger.warning("Failed to fetch RGW buckets for user list: %s", exc)

    # Add the virtual admin user at the top
    admin_used = user_usage.get("admin", 0)
    result.append({
        "id": "admin",
        "username": settings.admin_username,
        "display_name": "Administrator",
        "role": "admin",
        "quota_bytes": 0,
        "used_bytes": admin_used,
        "rgw_user_id": "admin",
        "rgw_access_key": settings.rgw_access_key,
        "bucket_count": bucket_counts.get("admin", 0),
        "created_at": None,
    })

    for u in users:
        owner_id = u.rgw_user_id
        bucket_count = bucket_counts.get(owner_id, 0) if owner_id else 0
        used_bytes = user_usage.get(owner_id, 0) if owner_id else 0

        result.append({
            "id": str(u.id),
            "username": u.username,
            "display_name": u.display_name,
            "role": u.role,
            "quota_bytes": u.quota_bytes,
            "used_bytes": used_bytes,
            "rgw_user_id": u.rgw_user_id,
            "rgw_access_key": u.rgw_access_key,
            "bucket_count": bucket_count,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        })
    return result


@router.get("/audit-logs", response_model=list[AuditLogOut])
async def list_audit_logs(
    db: AsyncSession = Depends(get_db), admin: dict = Depends(require_admin)
):
    return await get_audit_logs(db)


@router.post("/users", response_model=UserCreatedResponse)
async def create_new_user(
    data: CreateUserRequest,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(require_admin),
):
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

    quota_mb = (data.user_quota_max_size_kb // 1024) if (data.user_quota_enabled and data.user_quota_max_size_kb > 0) else -1
    await log_action(
        db, admin, "CREATE_USER", {"username": data.username, "quota_mb": quota_mb}
    )

    return UserCreatedResponse(
        message="User created with RGW credentials",
        user=user,
        rgw_access_key=access_key,
        rgw_secret_key=secret_key,
    )


async def _delete_user_buckets(ak: str, sk: str) -> None:
    """Delete all objects and buckets owned by this S3 user, off the event loop."""
    def _sync_delete() -> None:
        client = RGWClient(access_key=ak, secret_key=sk)
        buckets = client.list_buckets()
        for b in buckets:
            name = b["name"]
            token = None
            while True:
                objs = client.list_objects(name, max_keys=1000, continuation_token=token)
                for obj in objs["objects"]:
                    client.delete_object(name, obj["key"])
                if not objs["is_truncated"]:
                    break
                token = objs["next_token"]
            # Delete the bucket itself
            try:
                client.delete_bucket(name)
            except Exception:
                pass  # best-effort

    await asyncio.to_thread(_sync_delete)


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
    username = user.username
    await delete_user(db, user_id)
    await log_action(
        db, admin, "DELETE_USER", {"username": username, "user_id": str(user_id)}
    )

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
            await log_action(
                db,
                admin,
                "DELETE_USER",
                {"username": user.username, "user_id": str(uid)},
            )
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


@router.get("/rgw-users")
async def list_ceph_rgw_users(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List RGW users from Ceph that have **not** already been imported
    into the app database.
    """
    try:
        raw_users = await list_rgw_users()
        logger.info("list_rgw_users returned %s items", len(raw_users))
        if raw_users:
            logger.info("First raw item type=%s value=%s", type(raw_users[0]).__name__, str(raw_users[0])[:200])

        # Normalise: ensure we only process dicts (Admin Ops may return strings)
        users = [u for u in raw_users if isinstance(u, dict)]

        # Find which RGW UIDs have already been imported into the app DB
        imported_uids = set()
        try:
            stmt = select(User.rgw_user_id).where(
                User.rgw_user_id.isnot(None)
            )
            result = await db.execute(stmt)
            imported_uids = {row[0] for row in result if row[0]}
        except Exception:
            pass  # Non-fatal — just show all users

        # Return key fields, excluding already-imported users
        result = []
        for u in users:
            uid = u.get("user_id", u.get("uid", ""))
            if uid in imported_uids:
                continue  # Skip already imported
            keys = u.get("keys", u.get("key", []))
            access_key = keys[0].get("access_key", "") if keys else ""
            secret_key = keys[0].get("secret_key", "") if keys else ""
            buckets = u.get("bucket_count", u.get("buckets", []))
            bucket_count = len(buckets) if isinstance(buckets, list) else (buckets or 0)
            result.append({
                "uid": uid,
                "display_name": u.get("display_name", ""),
                "access_key": access_key,
                "secret_key": secret_key,
                "bucket_count": bucket_count,
                "max_buckets": u.get("max_buckets", 0),
                "suspended": u.get("suspended", 0),
            })
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list RGW users: {exc}")


@router.post("/rgw-users/{uid:path}/import")
async def import_rgw_user(
    uid: str,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Import an existing Ceph RGW user into the application database.

    Creates a new app user linked to the existing Ceph RGW user so they
    can log into the dashboard and manage their buckets/objects.
    """
    from app.services.user_service import (
        create_user as _create_user,
        get_user_by_username,
        update_rgw_creds as _update_rgw_creds,
    )

    # Fetch the RGW user from Ceph
    try:
        rgw_user = await get_rgw_user(uid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch RGW user '{uid}': {exc}")

    if not rgw_user:
        raise HTTPException(status_code=404, detail=f"RGW user '{uid}' not found in Ceph")

    keys = extract_rgw_keys(rgw_user)
    if not keys:
        raise HTTPException(status_code=400, detail=f"RGW user '{uid}' has no S3 keys")

    access_key, secret_key = keys
    display_name = rgw_user.get("display_name", uid)
    username = uid.replace(" ", "_").replace(".", "-")[:100]

    # Avoid duplicate usernames
    existing = await get_user_by_username(db, username)
    if existing:
        # Append a suffix
        suffix = 2
        while await get_user_by_username(db, f"{username}-{suffix}"):
            suffix += 1
        username = f"{username}-{suffix}"

    # Create the app user with a random password (they'll reset on first login)
    import secrets
    temp_password = secrets.token_urlsafe(12)

    user = await _create_user(
        db,
        username=username,
        password=temp_password,
        display_name=display_name,
        quota_mb=1000,  # generous default
        rgw_user_id=uid,
        rgw_access_key=access_key,
        rgw_secret_key=secret_key,
    )

    return {
        "message": f"RGW user '{uid}' imported as '{username}'",
        "user_id": str(user.id),
        "username": username,
        "display_name": display_name,
        "temp_password": temp_password,
        "rgw_access_key": access_key,
        "rgw_secret_key": secret_key,
    }


@router.post("/users/{user_id}/recalculate-usage")
async def recalculate_user_usage(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Recalculate a user's actual usage by scanning all objects
    across all their buckets."""
    # ── Admin user (virtual, not in DB) ──
    if user_id == "admin":
        try:
            def _scan_admin() -> int:
                client = RGWClient(
                    access_key=settings.rgw_access_key,
                    secret_key=settings.rgw_secret_key,
                )
                total = 0
                buckets = client.list_buckets()
                for b in buckets:
                    token = None
                    while True:
                        objs = client.list_objects(b["name"], max_keys=1000, continuation_token=token)
                        total += sum(obj["size"] for obj in objs["objects"])
                        if not objs["is_truncated"]:
                            break
                        token = objs["next_token"]
                return total

            total = await asyncio.to_thread(_scan_admin)
            return {"used_bytes": total, "quota_bytes": 0}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    # ── DB user ──
    uid = uuid.UUID(user_id)
    user = await get_user_by_id(db, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.rgw_access_key or not user.rgw_secret_key:
        raise HTTPException(status_code=400, detail="User has no RGW credentials")

    try:
        client = RGWClient(access_key=user.rgw_access_key, secret_key=user.rgw_secret_key)
        total = await recalculate_usage(db, uid, client)
        return {"used_bytes": total, "quota_bytes": user.quota_bytes}

    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

"""RGW S3 endpoints — list buckets and objects.

Admin: uses Ceph Dashboard API to see ALL buckets, S3 admin keys for objects.
Tenant: uses their own S3 keys — sees only their own buckets/objects.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db import get_db
from app.services.rgw_admin import list_rgw_buckets
from app.services.rgw_client import RGWClient, RGWError
from app.services.user_service import update_used_bytes
from app.services.audit_service import log_action

router = APIRouter(prefix="/rgw", tags=["rgw"])

ADMIN_ID = "admin"


def _is_admin(current_user: dict) -> bool:
    return current_user.get("role") == "admin" or current_user.get("id") == ADMIN_ID


def _get_user_client(current_user: dict) -> RGWClient:
    """Build an RGWClient using the correct S3 keys for this user."""
    ak = current_user.get("rgw_access_key")
    sk = current_user.get("rgw_secret_key")

    if current_user.get("id") == ADMIN_ID:
        return RGWClient()

    if not ak or not sk:
        raise HTTPException(
            status_code=403,
            detail="This user has no RGW credentials. Contact an admin.",
        )
    return RGWClient(access_key=ak, secret_key=sk)


@router.get("/buckets")
async def list_buckets(current_user: dict = Depends(get_current_user)):
    if _is_admin(current_user):
        try:
            raw_buckets = await list_rgw_buckets()
            buckets = []
            for b in raw_buckets:
                name = b.get("bucket", "")
                usage = b.get("usage", {})
                rgw_main = usage.get("rgw.main", {}) if isinstance(usage, dict) else {}
                size_bytes = (
                    rgw_main.get("size", 0)
                    or rgw_main.get("size_bytes", 0)
                    or b.get("size", b.get("size_bytes", 0))
                )
                object_count = (
                    rgw_main.get("num_objects", 0)
                    or b.get("num_objects", b.get("object_count", 0))
                )
                buckets.append({
                    "name": name,
                    "creation_date": b.get("creation_date", ""),
                    "object_count": object_count,
                    "size_bytes": size_bytes,
                    "owner": b.get("owner", ""),
                })
            buckets.sort(key=lambda x: x["name"])
            return {"buckets": buckets}
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        client = _get_user_client(current_user)
        raw = client.list_buckets()
        own_uid = current_user.get("rgw_user_id")
        if own_uid:
            try:
                admin_view = await list_rgw_buckets()
                owners = {b.get("bucket", ""): b.get("owner", "") for b in admin_view}
                raw = [b for b in raw if owners.get(b["name"], own_uid) == own_uid]
            except Exception:
                pass
        buckets = []
        for b in raw:
            try:
                objs = client.list_all_objects(b["name"])
                total_size = sum(o["size"] for o in objs["objects"])
                buckets.append({
                    "name": b["name"],
                    "creation_date": b.get("creation_date", ""),
                    "object_count": objs["total_count"],
                    "size_bytes": total_size,
                })
            except RGWError:
                buckets.append({
                    "name": b["name"],
                    "creation_date": b.get("creation_date", ""),
                    "object_count": 0,
                    "size_bytes": 0,
                })
        return {"buckets": buckets}
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/buckets/stats")
async def get_all_bucket_stats(current_user: dict = Depends(get_current_user)):
    """Return per-bucket stats (object count, total size) for all buckets.
    Only available for admin users.
    """
    if not _is_admin(current_user):
        # Tenant: use S3 to compute stats per bucket
        try:
            client = _get_user_client(current_user)
            buckets = client.list_buckets()
            result = []
            for b in buckets:
                try:
                    objs = client.list_all_objects(b["name"])
                    total_size = sum(o["size"] for o in objs["objects"])
                    result.append({
                        "name": b["name"],
                        "object_count": objs["total_count"],
                        "size_bytes": total_size,
                    })
                except RGWError:
                    result.append({"name": b["name"], "object_count": 0, "size_bytes": 0})
            return {"buckets": result}
        except RGWError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Admin: use the Admin Ops API directly
    try:
        raw_buckets = await list_rgw_buckets()
        result = []
        for b in raw_buckets:
            name = b.get("bucket", "")
            usage = b.get("usage", {})
            rgw_main = usage.get("rgw.main", {}) if isinstance(usage, dict) else {}
            result.append({
                "name": name,
                "object_count": rgw_main.get("num_objects", 0) or b.get("num_objects", 0),
                "size_bytes": rgw_main.get("size", 0) or b.get("size", 0),
            })
        return {"buckets": result}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/buckets/{name}/objects")
async def list_objects(
    name: str,
    max_keys: int = 100,
    fetch_all: bool = False,
    continuation_token: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    try:
        client = _get_user_client(current_user)
        if fetch_all:
            return client.list_all_objects(name)
        return client.list_objects(
            name, max_keys=max_keys, continuation_token=continuation_token
        )
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/buckets/{bucket}/objects/{key:path}")
async def delete_object(
    bucket: str,
    key: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        client = _get_user_client(current_user)
        # Get object size before deleting (for usage tracking)
        try:
            head = client.get_s3_client().head_object(Bucket=bucket, Key=key)
            obj_size = head.get("ContentLength", 0)
        except Exception:
            obj_size = 0

        result = client.delete_object(bucket, key)

        # Track usage
        uid = uuid.UUID(current_user["id"]) if current_user["id"] != "admin" else None
        if uid and obj_size:
            await update_used_bytes(db, uid, -obj_size)

        await log_action(
            db, current_user, "DELETE_OBJECT", {"bucket": bucket, "key": key}
        )

        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class BulkDeleteObjectsRequest(BaseModel):
    keys: list[str]


@router.post("/buckets/{bucket}/objects/bulk-delete")
async def bulk_delete_objects(
    bucket: str,
    data: BulkDeleteObjectsRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        client = _get_user_client(current_user)
        uid = uuid.UUID(current_user["id"]) if current_user["id"] != "admin" else None
        results = []
        total_size = 0

        for key in data.keys:
            try:
                head = client.get_s3_client().head_object(Bucket=bucket, Key=key)
                obj_size = head.get("ContentLength", 0)
            except Exception:
                obj_size = 0

            try:
                client.delete_object(bucket, key)
                results.append({"key": key, "status": "deleted"})
                total_size += obj_size
            except Exception as exc:
                results.append({"key": key, "status": "error", "detail": str(exc)})

        if uid and total_size:
            await update_used_bytes(db, uid, -total_size)

        await log_action(
            db,
            current_user,
            "DELETE_OBJECT",
            {"bucket": bucket, "keys": data.keys, "bulk": True},
        )

        return {"results": results, "total_freed": total_size}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/buckets/{bucket}/objects/{key:path}/download")
async def download_object(
    bucket: str,
    key: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a presigned download URL valid for 1 hour."""
    try:
        client = _get_user_client(current_user)
        url = client.presigned_url(bucket, key)
        await log_action(
            db, current_user, "DOWNLOAD_OBJECT", {"bucket": bucket, "key": key}
        )
        return {"url": url}
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class PresignRequest(BaseModel):
    # 60s floor (no surprise sub-minute links from a buggy slider).
    # 7-day ceiling matches AWS SigV4's hard max of 604800s — boto3 rejects
    # anything larger, so bound it here for a clean 422 instead of a 502.
    expires_in: int = Field(3600, ge=60, le=7 * 24 * 3600)


@router.post("/buckets/{bucket}/objects/{key:path}/presign")
async def presign_object(
    bucket: str,
    key: str,
    data: PresignRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a time-limited share URL for an object.

    Distinct from /download: this returns a transferable capability whose
    lifetime the caller chose, so it gets its own audit action.
    """
    try:
        client = _get_user_client(current_user)
        url = client.presigned_url(bucket, key, expires_in=data.expires_in)
        # expires_at is computed against the server clock — the same clock the
        # signature is signed with — so the UI doesn't mislead users whose
        # local clock is skewed.
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=data.expires_in)
        ).isoformat()
        await log_action(
            db,
            current_user,
            "GENERATE_PRESIGNED_URL",
            {"bucket": bucket, "key": key, "expires_in": data.expires_in},
        )
        return {
            "url": url,
            "expires_in": data.expires_in,
            "expires_at": expires_at,
        }
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/keys")
async def list_my_keys(
    current_user: dict = Depends(get_current_user),
):
    """List all S3 keys for the current user."""
    uid = current_user.get("rgw_user_id")
    if not uid:
        return {"keys": []}

    try:
        from app.services.rgw_admin import get_rgw_user
        rgw_user = await get_rgw_user(uid)
        if not rgw_user:
            return {"keys": []}
        return {"keys": rgw_user.get("keys", [])}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/keys")
async def generate_new_key(
    current_user: dict = Depends(get_current_user),
):
    """Generate a new S3 credential pair."""
    uid = current_user.get("rgw_user_id")
    if not uid:
        raise HTTPException(status_code=400, detail="Cannot generate keys for this user")

    try:
        from app.services.rgw_admin_ops import RGWAdminOpsClient
        client = RGWAdminOpsClient()
        keys = await client.create_key(uid)
        return {"keys": keys}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/keys/{access_key}")
async def delete_key(
    access_key: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete an S3 credential pair."""
    uid = current_user.get("rgw_user_id")
    if not uid:
        raise HTTPException(status_code=400, detail="Invalid user")
    
    # Don't allow deleting the primary key used to login/sign requests in the DB
    if access_key == current_user.get("rgw_access_key"):
        raise HTTPException(status_code=400, detail="Cannot delete your primary access key")

    try:
        from app.services.rgw_admin_ops import RGWAdminOpsClient
        client = RGWAdminOpsClient()
        await client.delete_key(uid, access_key)
        return {"deleted": True}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

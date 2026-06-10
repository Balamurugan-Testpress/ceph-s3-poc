"""RGW S3 endpoints — list buckets and objects.

Admin: uses Ceph Dashboard API to see ALL buckets, S3 admin keys for objects.
Tenant: uses their own S3 keys — sees only their own buckets/objects.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.services.user_service import update_used_bytes


from app.api.deps import get_current_user
from app.services.rgw_client import RGWClient, RGWError
from app.services.ceph_api import CephApiClient, CephApiError

router = APIRouter(prefix="/rgw", tags=["rgw"])

ADMIN_ID = "admin"


def _get_user_client(current_user: dict) -> RGWClient:
    """Build an RGWClient using the correct S3 keys for this user."""
    ak = current_user.get("rgw_access_key")
    sk = current_user.get("rgw_secret_key")

    # Admin users don't have per-user keys — use env vars
    if current_user["id"] == ADMIN_ID:
        return RGWClient()

    # Tenant users must have keys stored in DB
    if not ak or not sk:
        raise HTTPException(
            status_code=403,
            detail="This user has no RGW credentials. Contact an admin.",
        )
    return RGWClient(access_key=ak, secret_key=sk)


@router.get("/buckets")
async def list_buckets(current_user: dict = Depends(get_current_user)):
    # Admin — list ALL buckets via Ceph Dashboard API
    if current_user["id"] == ADMIN_ID:
        try:
            async with CephApiClient() as ceph:
                bucket_names = await ceph.get("/api/rgw/bucket")
                buckets = [{"name": name, "creation_date": ""} for name in bucket_names]
                return {"buckets": buckets}
        except CephApiError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Tenant — list only their own buckets via S3
    try:
        client = _get_user_client(current_user)
        return {"buckets": client.list_buckets()}
    except RGWError as exc:
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
        return client.list_objects(name, max_keys=max_keys, continuation_token=continuation_token)
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

        return {"results": results, "total_freed": total_size}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/buckets/{bucket}/objects/{key:path}/download")
async def download_object(
    bucket: str,
    key: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a presigned download URL valid for 1 hour."""
    try:
        client = _get_user_client(current_user)
        url = client.presigned_url(bucket, key)
        return {"url": url}
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

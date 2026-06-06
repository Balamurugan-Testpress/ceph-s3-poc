"""S3 write operations — create buckets, upload objects, track usage."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.rgw import _get_user_client
from app.db import get_db
from app.db.schemas import CreateBucketRequest
from app.services.rgw_client import RGWError
from app.services.user_service import recalculate_usage, update_used_bytes

router = APIRouter(prefix="/s3", tags=["s3"])


@router.post("/buckets")
async def create_bucket(
    data: CreateBucketRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        client = _get_user_client(current_user)
        return client.create_bucket(data.name)
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/buckets/{bucket}/upload")
async def upload_object(
    bucket: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file and track usage delta. Blocks if over quota."""
    try:
        contents = await file.read()
        uid = uuid.UUID(current_user["id"]) if current_user["id"] != "admin" else None

        # Quota check (tenants only)
        if uid:
            used = current_user.get("used_bytes", 0)
            quota = current_user.get("quota_bytes", 0)
            if used + len(contents) > quota:
                raise HTTPException(
                    status_code=413,
                    detail=f"Quota exceeded: {used + len(contents)} > {quota} bytes",
                )

        client = _get_user_client(current_user)
        result = client.upload_object(bucket, file.filename or "unnamed", contents)

        # Track usage
        if uid:
            await update_used_bytes(db, uid, len(contents))

        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/usage")
async def get_usage(
    current_user: dict = Depends(get_current_user),
):
    """Return current user's usage and quota."""
    return {
        "used_bytes": current_user.get("used_bytes", 0),
        "quota_bytes": current_user.get("quota_bytes", 0),
    }


@router.post("/recalculate-usage")
async def recalculate_user_usage(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Scan all objects and update used_bytes to the real total."""
    uid = uuid.UUID(current_user["id"]) if current_user["id"] != "admin" else None
    if not uid:
        raise HTTPException(status_code=400, detail="Admin usage is not tracked")

    try:
        client = _get_user_client(current_user)
        total = await recalculate_usage(db, uid, client)
        return {"used_bytes": total, "quota_bytes": current_user["quota_bytes"]}
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

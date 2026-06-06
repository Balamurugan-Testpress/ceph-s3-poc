"""S3 write operations — create buckets and upload objects."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.api.deps import get_current_user
from app.api.rgw import _get_user_client
from app.db.schemas import CreateBucketRequest
from app.services.rgw_client import RGWError

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
):
    try:
        contents = await file.read()
        client = _get_user_client(current_user)
        return client.upload_object(bucket, file.filename or "unnamed", contents)
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

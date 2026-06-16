"""Multipart upload presigning + finalization.

The browser uploads parts directly to RGW with presigned URLs — bytes never
pass through the API worker. This module is where the backend still
participates: it mints the upload id, mints per-part URLs, enforces quota at
init+complete, and writes audit + usage rows once the upload succeeds.

Flow (one upload):

  1. Browser → POST /api/multipart/init  →  {upload_id, part_size, part_count}
  2. Browser → POST /api/multipart/presign-part (×N)  →  {url}
  3. Browser → PUT url (direct to RGW)  →  ETag in response header
  4. Browser → POST /api/multipart/complete  with [{part_number, etag}, ...]
  5. Browser → POST /api/multipart/abort  if the user cancels

Resume (page reload or pause): the browser keeps its own (uploadId, parts)
in IndexedDB. On resume it calls GET /api/multipart/{bucket}/{key}/parts to
reconcile against what RGW actually has, then continues from there.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.rgw import _get_user_client
from app.db import get_db
from app.services.audit_service import log_action
from app.services.rgw_client import RGWError
from app.services.user_service import update_used_bytes

router = APIRouter(prefix="/multipart", tags=["multipart"])


# 8 MiB parts. Small enough that a paused upload only "loses" a few MB of
# in-flight work, large enough that an 80 GB upload still fits under S3's
# 10,000-part limit. Documented in the plan; if you tune this, also tune the
# 16 MiB threshold in UploadsContext.jsx that decides single-PUT vs multipart.
PART_SIZE = 8 * 1024 * 1024


def _quota_check(current_user: dict, additional: int) -> None:
    """Raise 413 if accepting *additional* bytes would put the user over quota.

    Admin (no uid) is unlimited — same convention as the single-PUT path in
    app/api/s3.py:upload_object.
    """
    if current_user["id"] == "admin":
        return
    used = current_user.get("used_bytes", 0)
    quota = current_user.get("quota_bytes", 0)
    if quota > 0 and used + additional > quota:
        raise HTTPException(
            status_code=413,
            detail=f"Quota exceeded: {used + additional} > {quota} bytes",
        )


# ── Init ────────────────────────────────────────────────────────────────────

class InitRequest(BaseModel):
    bucket: str
    key: str
    size: int = Field(..., ge=1)
    content_type: str | None = None


class InitResponse(BaseModel):
    upload_id: str
    part_size: int
    part_count: int


@router.post("/init", response_model=InitResponse)
async def init_multipart(
    data: InitRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _quota_check(current_user, data.size)
    try:
        client = _get_user_client(current_user)
        upload_id = await run_in_threadpool(
            client.create_multipart_upload, data.bucket, data.key, data.content_type
        )
        part_count = max(1, -(-data.size // PART_SIZE))  # ceil div
        await log_action(
            db,
            current_user,
            "INIT_MULTIPART_UPLOAD",
            {
                "bucket": data.bucket,
                "key": data.key,
                "upload_id": upload_id,
                "size": data.size,
                "part_count": part_count,
            },
        )
        return InitResponse(
            upload_id=upload_id, part_size=PART_SIZE, part_count=part_count
        )
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# ── Per-part presign ────────────────────────────────────────────────────────

class PresignPartRequest(BaseModel):
    bucket: str
    key: str
    upload_id: str
    part_number: int = Field(..., ge=1, le=10_000)
    # 1 hour ceiling. Parts shouldn't take longer than this to PUT; if one does,
    # the engine will request a fresh URL and try again.
    expires_in: int = Field(3600, ge=60, le=3600)


class PresignPartResponse(BaseModel):
    url: str
    expires_at: str


@router.post("/presign-part", response_model=PresignPartResponse)
async def presign_part(
    data: PresignPartRequest,
    current_user: dict = Depends(get_current_user),
):
    """Mint a presigned PUT for one part. No DB writes — this gets called N
    times per upload and is on the hot path."""
    try:
        client = _get_user_client(current_user)
        url = await run_in_threadpool(
            client.presigned_upload_part_url,
            data.bucket,
            data.key,
            data.upload_id,
            data.part_number,
            data.expires_in,
        )
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=data.expires_in)
        ).isoformat()
        return PresignPartResponse(url=url, expires_at=expires_at)
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# ── Complete ────────────────────────────────────────────────────────────────

class CompletePart(BaseModel):
    part_number: int = Field(..., ge=1, le=10_000)
    etag: str


class CompleteRequest(BaseModel):
    bucket: str
    key: str
    upload_id: str
    parts: list[CompletePart]
    total_size: int = Field(..., ge=1)


@router.post("/complete")
async def complete_multipart(
    data: CompleteRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Finalize the upload, then book the bytes against the user's quota.

    Re-check quota here: between init and complete, the user may have uploaded
    other things from another tab. Without this, a determined user could
    double-spend their quota by starting two large uploads in parallel.
    """
    _quota_check(current_user, data.total_size)
    # boto3 expects parts sorted ascending and shaped as {PartNumber, ETag}.
    parts = sorted(
        [{"PartNumber": p.part_number, "ETag": p.etag} for p in data.parts],
        key=lambda p: p["PartNumber"],
    )
    try:
        client = _get_user_client(current_user)
        result = await run_in_threadpool(
            client.complete_multipart_upload,
            data.bucket,
            data.key,
            data.upload_id,
            parts,
        )
        # Usage accounting — same shape as the single-PUT path in app/api/s3.py.
        uid = uuid.UUID(current_user["id"]) if current_user["id"] != "admin" else None
        if uid:
            await update_used_bytes(db, uid, data.total_size)
        await log_action(
            db,
            current_user,
            "COMPLETE_MULTIPART_UPLOAD",
            {
                "bucket": data.bucket,
                "key": data.key,
                "upload_id": data.upload_id,
                "total_size": data.total_size,
                "part_count": len(parts),
            },
        )
        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# ── Abort ───────────────────────────────────────────────────────────────────

class AbortRequest(BaseModel):
    bucket: str
    key: str
    upload_id: str


@router.post("/abort")
async def abort_multipart(
    data: AbortRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel an in-progress multipart, releasing the parts on RGW.

    Best-effort: a 404 from RGW (upload id already gone) is fine — we still
    return ok so the browser can clean up its IndexedDB row.
    """
    try:
        client = _get_user_client(current_user)
        try:
            await run_in_threadpool(
                client.abort_multipart_upload,
                data.bucket,
                data.key,
                data.upload_id,
            )
        except RGWError as exc:
            if "NoSuchUpload" not in str(exc):
                raise
        await log_action(
            db,
            current_user,
            "ABORT_MULTIPART_UPLOAD",
            {"bucket": data.bucket, "key": data.key, "upload_id": data.upload_id},
        )
        return {"ok": True}
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# ── List parts (for resume) ─────────────────────────────────────────────────

@router.get("/{bucket}/{key:path}/parts")
async def list_uploaded_parts(
    bucket: str,
    key: str,
    upload_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """Return parts RGW thinks it already has — the browser reconciles this
    against its IndexedDB cache before resuming."""
    try:
        client = _get_user_client(current_user)
        parts = await run_in_threadpool(client.list_parts, bucket, key, upload_id)
        return {"parts": parts}
    except RGWError as exc:
        # RGW returns NoSuchUpload when the multipart id is unknown, but for
        # an *aborted* upload it returns NoSuchKey (the object stub is gone).
        # Both mean the same thing to us: the upload is no longer resumable,
        # tell the browser to start over.
        msg = str(exc)
        if "NoSuchUpload" in msg or "NoSuchKey" in msg:
            return {"parts": [], "expired": True}
        raise HTTPException(status_code=502, detail=msg) from exc

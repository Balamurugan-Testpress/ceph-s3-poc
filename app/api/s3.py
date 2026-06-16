"""S3 write operations — create buckets, upload objects, track usage."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.rgw import _get_user_client
from app.config import settings
from app.db import get_db
from app.db.models import AuditLog
from app.db.schemas import CreateBucketRequest
from app.services.rgw_client import RGWError
from app.services.user_service import recalculate_usage, update_used_bytes
from app.services.audit_service import log_action

router = APIRouter(prefix="/s3", tags=["s3"])


@router.post("/buckets")
async def create_bucket(
    data: CreateBucketRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        client = _get_user_client(current_user)
        result = client.create_bucket(data.name)
        # Install CORS immediately so the browser can do direct multipart PUTs
        # without an extra round trip. Best-effort: a CORS failure shouldn't
        # block bucket creation — admin can re-run /cors/ensure later.
        try:
            client.put_bucket_cors(data.name, allowed_origin=settings.dashboard_origin)
        except RGWError:
            pass
        await log_action(db, current_user, "CREATE_BUCKET", {"bucket": data.name})
        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/buckets/{bucket}/cors/ensure")
async def ensure_bucket_cors(
    bucket: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Install the dashboard CORS rule on an existing bucket.

    For buckets that predate this feature — create_bucket sets CORS for new
    ones automatically.
    """
    try:
        client = _get_user_client(current_user)
        result = client.put_bucket_cors(bucket, allowed_origin=settings.dashboard_origin)
        await log_action(db, current_user, "SET_BUCKET_CORS", {"bucket": bucket})
        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/buckets/{bucket}")
async def delete_bucket_endpoint(
    bucket: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an empty bucket."""
    try:
        client = _get_user_client(current_user)
        result = client.delete_bucket(bucket)
        await log_action(db, current_user, "DELETE_BUCKET", {"bucket": bucket})
        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/buckets/{bucket}/upload")
async def upload_object(
    bucket: str,
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file and track usage delta. Blocks if over quota.

    Two pieces of "don't be unresponsive" here:

    1) The S3 PUT is a synchronous boto3 call. Running it directly on the
       event loop freezes every other request to this worker until it
       finishes — for a 500MB file that's seconds-to-minutes of blocked
       /buckets, /objects, etc. We push it to a threadpool so the loop
       stays free.

    2) If the client disconnected (browser closed, user hit cancel after
       the bytes had already arrived but before the PUT completed), we
       skip the PUT entirely and return 499 (Nginx's "client closed
       request" convention). Saves bandwidth to RGW and prevents the
       "I cancelled but the object still appeared" bug.
    """
    try:
        contents = await file.read()
        uid = uuid.UUID(current_user["id"]) if current_user["id"] != "admin" else None

        # Quota check (tenants only)
        if uid:
            used = current_user.get("used_bytes", 0)
            quota = current_user.get("quota_bytes", 0)
            if quota > 0 and used + len(contents) > quota:
                raise HTTPException(
                    status_code=413,
                    detail=f"Quota exceeded: {used + len(contents)} > {quota} bytes",
                )

        if await request.is_disconnected():
            return Response(status_code=499)

        client = _get_user_client(current_user)
        result = await run_in_threadpool(
            client.upload_object, bucket, file.filename or "unnamed", contents
        )

        # Track usage
        if uid:
            await update_used_bytes(db, uid, len(contents))

        await log_action(
            db,
            current_user,
            "UPLOAD_OBJECT",
            {"bucket": bucket, "key": file.filename or "unnamed"},
        )

        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/buckets/{bucket}/policy")
async def get_bucket_policy(
    bucket: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        client = _get_user_client(current_user)
        policy = client.get_bucket_policy(bucket)
        return {"policy": policy}
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


from pydantic import BaseModel
class PutPolicyRequest(BaseModel):
    policy: str


@router.put("/buckets/{bucket}/policy")
async def put_bucket_policy(
    bucket: str,
    data: PutPolicyRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        client = _get_user_client(current_user)
        result = client.put_bucket_policy(bucket, data.policy)
        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/buckets/{bucket}/policy")
async def delete_bucket_policy(
    bucket: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        client = _get_user_client(current_user)
        result = client.delete_bucket_policy(bucket)
        return result
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/usage")
async def get_usage(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return current user's usage and quota."""
    uid = current_user.get("rgw_user_id")
    used_bytes = current_user.get("used_bytes", 0)
    
    if uid and uid != "admin":
        try:
            from app.services.rgw_admin import get_rgw_user
            rgw_user = await get_rgw_user(uid, stats=True)
            if rgw_user and "stats" in rgw_user:
                # "size_actual" and "size" are in bytes. "size_kb" is in KB.
                stats = rgw_user["stats"]
                used_bytes = stats.get("size_actual", stats.get("size", stats.get("size_kb", 0) * 1024))
                
                # Update our DB cache in the background
                from app.services.user_service import get_user_by_id
                db_user = await get_user_by_id(db, uuid.UUID(current_user["id"]))
                if db_user:
                    db_user.used_bytes = used_bytes
                    await db.commit()
        except Exception:
            pass # Fallback to cached used_bytes

    return {
        "used_bytes": used_bytes,
        "quota_bytes": current_user.get("quota_bytes", 0),
        "is_admin": current_user.get("id") == "admin" or current_user.get("role") == "admin",
    }


@router.get("/activity")
async def my_activity(
    days: int = Query(14, ge=1, le=90),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Audit-log activity for the *current* user, bucketed by day and action.

    Same shape as /admin/analytics/activity but filtered to this user — lets
    the tenant dashboard show their own activity timeline.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)
    day_col = func.date_trunc("day", AuditLog.timestamp).label("day")
    stmt = (
        select(day_col, AuditLog.action, func.count().label("count"))
        .where(
            AuditLog.timestamp >= since,
            AuditLog.user_id == str(current_user["id"]),
        )
        .group_by(day_col, AuditLog.action)
        .order_by(day_col)
    )
    rows = (await db.execute(stmt)).all()
    series = [
        {
            "day": row.day.date().isoformat() if row.day else None,
            "action": row.action,
            "count": int(row.count),
        }
        for row in rows
    ]
    return {"days": days, "series": series}


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

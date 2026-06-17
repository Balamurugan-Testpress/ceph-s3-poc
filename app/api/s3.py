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
from app.services.rgw_admin_ops import RGWAdminOpsClient, RGWAdminOpsError
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
    """Create a bucket and apply any optional settings the wizard requested.

    The bucket itself is created with a single S3 ``CreateBucket`` call that
    folds in the canned ACL and the object-lock flag (object lock cannot be
    added later — Ceph rejects it with 409 ``InvalidBucketState``).
    Everything else is applied as a follow-up call; if one of those fails
    the bucket still exists, so we collect per-step status into
    ``applied`` / ``failed`` rather than rolling back. The caller can decide
    whether the partial state is acceptable.
    """
    # Per-bucket rate limit goes through Admin Ops with `ratelimit=write`
    # caps; a tenant's S3 keys would get 403 from RGW. Reject up front so
    # the user sees a clear 403, not a buried sub-step failure.
    is_admin = current_user.get("id") == "admin" or current_user.get("role") == "admin"
    if data.rate_limit is not None and not is_admin:
        raise HTTPException(
            status_code=403,
            detail="Per-bucket rate limit requires admin privileges.",
        )

    try:
        client = _get_user_client(current_user)
    except HTTPException:
        raise

    # ── Step 1: create the bucket (fatal if this fails) ──
    try:
        client.create_bucket(
            data.name,
            acl=data.acl,
            object_lock_enabled=data.object_lock_enabled,
        )
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await log_action(db, current_user, "CREATE_BUCKET", {"bucket": data.name})

    applied: list[str] = []
    failed: list[dict] = []

    # ── Step 2: CORS (best-effort, predates the wizard) ──
    # Browser direct multipart PUTs need ExposeHeaders=ETag; admin can
    # re-run /cors/ensure later if this fails.
    try:
        client.put_bucket_cors(data.name, allowed_origin=settings.dashboard_origin)
        applied.append("cors")
    except RGWError as exc:
        failed.append({"step": "cors", "error": str(exc)})

    # ── Step 3: versioning ──
    # Object Lock implicitly enables versioning, but we set it explicitly
    # so a subsequent get_bucket_versioning() returns a defined state.
    if data.versioning_enabled or data.object_lock_enabled:
        try:
            client.put_bucket_versioning(data.name, "Enabled")
            await log_action(
                db, current_user, "SET_BUCKET_VERSIONING",
                {"bucket": data.name, "status": "Enabled"},
            )
            applied.append("versioning")
        except RGWError as exc:
            failed.append({"step": "versioning", "error": str(exc)})

    # ── Step 4: object lock default retention ──
    if data.object_lock is not None:
        try:
            client.put_object_lock_configuration(
                data.name,
                data.object_lock.mode,
                days=data.object_lock.retention_days,
                years=data.object_lock.retention_years,
            )
            await log_action(
                db, current_user, "SET_BUCKET_OBJECT_LOCK",
                {
                    "bucket": data.name,
                    "mode": data.object_lock.mode,
                    "days": data.object_lock.retention_days,
                    "years": data.object_lock.retention_years,
                },
            )
            applied.append("object_lock")
        except RGWError as exc:
            failed.append({"step": "object_lock", "error": str(exc)})

    # ── Step 5: tags ──
    if data.tags:
        try:
            client.put_bucket_tagging(
                data.name,
                [{"Key": t.key, "Value": t.value} for t in data.tags],
            )
            await log_action(
                db, current_user, "SET_BUCKET_TAGGING",
                {"bucket": data.name, "tags": [t.key for t in data.tags]},
            )
            applied.append("tags")
        except RGWError as exc:
            failed.append({"step": "tags", "error": str(exc)})

    # ── Step 6: policy (raw JSON) ──
    if data.policy:
        try:
            client.put_bucket_policy(data.name, data.policy)
            await log_action(
                db, current_user, "SET_BUCKET_POLICY",
                {"bucket": data.name},
            )
            applied.append("policy")
        except RGWError as exc:
            failed.append({"step": "policy", "error": str(exc)})

    # ── Step 7: ACL ──
    # We already passed `acl` to create_bucket; this branch is reserved
    # for the edge case where the wizard one day wants to re-apply it
    # post-create. For now we just record it in `applied` when it was
    # set at create time, so the response is honest about what's in effect.
    if data.acl:
        applied.append("acl")

    # ── Step 8: rate limit (admin only — gated above) ──
    if data.rate_limit is not None:
        try:
            admin_ops = RGWAdminOpsClient()
            await admin_ops.set_bucket_rate_limit(
                data.name,
                enabled=data.rate_limit.enabled,
                max_read_ops=data.rate_limit.max_read_ops,
                max_write_ops=data.rate_limit.max_write_ops,
                max_read_bytes=data.rate_limit.max_read_bytes,
                max_write_bytes=data.rate_limit.max_write_bytes,
            )
            await log_action(
                db, current_user, "SET_BUCKET_RATE_LIMIT",
                {"bucket": data.name, "enabled": data.rate_limit.enabled},
            )
            applied.append("rate_limit")
        except RGWAdminOpsError as exc:
            failed.append({"step": "rate_limit", "error": str(exc)})

    return {
        "name": data.name,
        "created": True,
        "applied": applied,
        "failed": failed,
    }


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

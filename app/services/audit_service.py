from __future__ import annotations

import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.db.models import AuditLog


async def log_action(
    db: AsyncSession,
    user: dict,
    action: str,
    details: dict | str | None = None,
) -> None:
    """Log an action performed by a user."""
    if isinstance(details, dict):
        details = json.dumps(details)

    audit_log = AuditLog(
        user_id=str(user.get("id", "unknown")),
        username=user.get("username", "unknown"),
        action=action,
        details=details,
    )
    db.add(audit_log)
    await db.commit()


async def get_audit_logs(db: AsyncSession, limit: int = 100):
    """Retrieve the most recent audit logs."""
    stmt = select(AuditLog).order_by(desc(AuditLog.timestamp)).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()

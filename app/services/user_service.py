"""User CRUD operations against PostgreSQL."""

from __future__ import annotations

import uuid

import bcrypt
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession,
    username: str,
    password: str,
    display_name: str = "",
    quota_gb: int = 1,
    rgw_user_id: str | None = None,
    rgw_access_key: str | None = None,
    rgw_secret_key: str | None = None,
) -> User:
    user = User(
        username=username,
        password_hash=hash_password(password),
        display_name=display_name or username,
        quota_bytes=quota_gb * 1_073_741_824,
        rgw_user_id=rgw_user_id,
        rgw_access_key=rgw_access_key,
        rgw_secret_key=rgw_secret_key,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def list_users(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars().all())


async def delete_user(db: AsyncSession, user_id: uuid.UUID) -> bool:
    result = await db.execute(delete(User).where(User.id == user_id))
    await db.commit()
    return result.rowcount > 0


async def update_rgw_creds(
    db: AsyncSession,
    user_id: uuid.UUID,
    rgw_user_id: str,
    rgw_access_key: str,
    rgw_secret_key: str,
) -> User | None:
    user = await get_user_by_id(db, user_id)
    if not user:
        return None
    user.rgw_user_id = rgw_user_id
    user.rgw_access_key = rgw_access_key
    user.rgw_secret_key = rgw_secret_key
    await db.commit()
    await db.refresh(user)
    return user


async def update_used_bytes(db: AsyncSession, user_id: uuid.UUID, delta: int) -> None:
    """Add *delta* bytes to the user's used_bytes (can be negative)."""
    user = await get_user_by_id(db, user_id)
    if not user:
        return
    user.used_bytes = max(0, user.used_bytes + delta)
    await db.commit()


async def recalculate_usage(db: AsyncSession, user_id: uuid.UUID, rgw_client) -> int:
    """Scan all objects across all buckets and update used_bytes.
    Returns the recalculated total."""
    total = 0
    buckets = rgw_client.list_buckets()
    for b in buckets:
        while True:
            objs = rgw_client.list_objects(b["name"], max_keys=1000)
            total += sum(obj["size"] for obj in objs["objects"])
            if not objs["is_truncated"]:
                break

    user = await get_user_by_id(db, user_id)
    if user:
        user.used_bytes = total
        await db.commit()
    return total

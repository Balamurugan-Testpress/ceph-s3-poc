"""Pydantic schemas for user management."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ── Request schemas ──


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=4, max_length=200)
    display_name: str = Field(default="", max_length=200)

    user_quota_enabled: bool = False
    user_quota_max_size_kb: int = -1
    user_quota_max_objects: int = -1
    bucket_quota_enabled: bool = False
    bucket_quota_max_size_kb: int = -1
    bucket_quota_max_objects: int = -1

    rate_limit_enabled: bool = False
    rate_limit_max_read_ops: int = 0
    rate_limit_max_write_ops: int = 0
    rate_limit_max_read_bytes: int = 0
    rate_limit_max_write_bytes: int = 0


class ObjectLockSettings(BaseModel):
    """Default retention applied to new objects in a lock-enabled bucket.

    `retention_days` and `retention_years` are mutually exclusive — RGW
    returns `MalformedXML` if both/neither is set on the underlying
    PutObjectLockConfiguration call.
    """

    mode: Literal["GOVERNANCE", "COMPLIANCE"]
    retention_days: int | None = Field(default=None, ge=1)
    retention_years: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _exactly_one_retention(self) -> "ObjectLockSettings":
        if (self.retention_days is None) == (self.retention_years is None):
            raise ValueError(
                "Provide exactly one of retention_days or retention_years"
            )
        return self


class BucketTag(BaseModel):
    key: str = Field(..., min_length=1, max_length=128)
    value: str = Field(default="", max_length=256)


class BucketRateLimitSettings(BaseModel):
    """Per-bucket rate limit. Requires admin caps to apply.

    0 means "no limit" for that dimension — matches the RGW Admin Ops
    convention.
    """

    enabled: bool = True
    max_read_ops: int = Field(default=0, ge=0)
    max_write_ops: int = Field(default=0, ge=0)
    max_read_bytes: int = Field(default=0, ge=0)
    max_write_bytes: int = Field(default=0, ge=0)


class CreateBucketRequest(BaseModel):
    """Create-bucket request with all the optional sub-settings the wizard
    can pass. Each block is independently applied after the bucket exists;
    failures are reported back in `failed[]` rather than rolled back.
    """

    name: str = Field(..., min_length=3, max_length=255)

    # S3-side settings (applied with the caller's S3 creds)
    versioning_enabled: bool = False
    object_lock_enabled: bool = False  # MUST be set at create time per Ceph
    object_lock: ObjectLockSettings | None = None  # default retention
    tags: list[BucketTag] = Field(default_factory=list)
    policy: str | None = None  # raw JSON string; None = skip
    acl: (
        Literal["private", "public-read", "public-read-write", "authenticated-read"]
        | None
    ) = None

    # Admin-ops side (admin caps required — rejected for tenants at the route)
    rate_limit: BucketRateLimitSettings | None = None

    @model_validator(mode="after")
    def _lock_consistency(self) -> "CreateBucketRequest":
        # Default retention only makes sense when lock is enabled at create.
        if self.object_lock is not None and not self.object_lock_enabled:
            raise ValueError(
                "object_lock retention requires object_lock_enabled=True"
            )
        return self


class LoginRequest(BaseModel):
    username: str
    password: str


# ── Response schemas ──


class UserOut(BaseModel):
    id: UUID | str
    username: str
    display_name: str | None = None
    role: str = "user"
    quota_bytes: int = 0
    used_bytes: int = 0
    rgw_user_id: str | None = None
    rgw_access_key: str | None = None
    bucket_count: int = 0
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserCreatedResponse(BaseModel):
    message: str
    user: UserOut
    rgw_access_key: str | None = None
    rgw_secret_key: str | None = None


class AuditLogOut(BaseModel):
    id: UUID
    user_id: str
    username: str
    action: str
    details: str | None = None
    timestamp: datetime

    model_config = {"from_attributes": True}

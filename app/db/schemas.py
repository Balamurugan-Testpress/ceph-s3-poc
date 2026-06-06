"""Pydantic schemas for user management."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


# ── Request schemas ──

class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=4, max_length=200)
    display_name: str = Field(default="", max_length=200)
    quota_mb: int = Field(default=100, ge=1, le=999999)


class CreateBucketRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=255)


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

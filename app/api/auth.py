import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth.jwt import create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class UserInfo(BaseModel):
    id: str
    username: str
    role: str
    display_name: str = ""


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    admin_user = os.getenv("ADMIN_USERNAME", "admin")
    admin_pass = os.getenv("ADMIN_PASSWORD", "admin")

    if data.username != admin_user or data.password != admin_pass:
        raise HTTPException(status_code=401, detail="Invalid Credentials")

    token = create_access_token("admin")
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserInfo(
            id="admin",
            username=admin_user,
            role="admin",
            display_name="Administrator",
        ),
    )

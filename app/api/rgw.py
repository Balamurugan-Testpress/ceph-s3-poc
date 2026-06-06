"""RGW S3 endpoints — list buckets and objects."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import require_admin
from app.services.rgw_client import RGWClient, RGWError

router = APIRouter(prefix="/rgw", tags=["rgw"])


@router.get("/buckets")
async def list_buckets(admin: dict = Depends(require_admin)):
    try:
        client = RGWClient()
        return {"buckets": client.list_buckets()}
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/buckets/{name}/objects")
async def list_objects(
    name: str,
    max_keys: int = 100,
    fetch_all: bool = False,
    continuation_token: str | None = None,
    admin: dict = Depends(require_admin),
):
    try:
        client = RGWClient()
        if fetch_all:
            return client.list_all_objects(name)
        return client.list_objects(name, max_keys=max_keys, continuation_token=continuation_token)
    except RGWError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

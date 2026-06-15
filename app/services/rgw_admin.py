"""RGW admin operations.

Provides two strategies for interacting with Ceph RGW:
  1. **RGW Admin Ops API** (primary) — talks directly to the RGW endpoint,
     no Ceph Dashboard dependency.
  2. **Ceph Dashboard API** (fallback) — used for creating/deleting users
     since the Dashboard manages the full lifecycle.

Functions here handle user CRUD, quota management, and listing RGW users
and buckets with their stats.
"""

from __future__ import annotations

import logging

from app.services.ceph_api import CephApiClient
from app.services.rgw_admin_ops import RGWAdminOpsClient, RGWAdminOpsError

logger = logging.getLogger("ceph-s3-poc")


# ── User listing via Admin Ops API (direct RGW, no Dashboard) ──


async def list_rgw_users() -> list[dict]:
    """Fetch all RGW users via the Admin Ops API.

    The RGW Admin Ops API may return either:
      - a list of user ID strings  ["u1", "u2", ...]
      - a list of user dicts       [{"uid": "u1", ...}, ...]

    This function normalises to a list of dicts by fetching details for
    string-only entries.
    """
    try:
        client = RGWAdminOpsClient()
        raw = await client.list_users()
        logger.info("list_users() returned %s items, first type=%s", len(raw), type(raw[0]).__name__ if raw else "N/A")
        result: list[dict] = []
        for item in raw:
            if isinstance(item, str):
                logger.debug("Fetching detail for string UID: %s", item)
                detail = await client.get_user(item)
                logger.debug("get_user(%s) returned: %s", item, detail is not None)
                if detail:
                    result.append(detail)
            elif isinstance(item, dict):
                logger.debug("Appending dict item with user_id=%s", item.get("user_id", item.get("uid", "?")))
                result.append(item)
        logger.info("Final normalised user count: %s", len(result))
        return result
    except RGWAdminOpsError:
        pass

    # Fallback: try the Ceph Dashboard API
    try:
        async with CephApiClient() as ceph:
            data = await ceph.get("/api/rgw/user")
            if isinstance(data, dict):
                users = data.get("users", [])
                return users if users else [data]
            if isinstance(data, list):
                # Might also be string lists from the Dashboard
                result = []
                client = RGWAdminOpsClient()
                for item in data:
                    if isinstance(item, str):
                        detail = await client.get_user(item)
                        if detail:
                            result.append(detail)
                    else:
                        result.append(item)
                return result
    except Exception:
        pass

    return []


async def get_rgw_user(uid: str, stats: bool = False) -> dict | None:
    """Fetch a single RGW user from Ceph (Admin Ops API, then Dashboard)."""
    try:
        print("Enter the get_rgw_user")
        client = RGWAdminOpsClient()
        print(client)
        user = await client.get_user(uid, stats=stats)
        print(user)
        if user:
            return user
        else:
            print("NO USER")
            return
    except RGWAdminOpsError:
        pass

    # Fallback: Ceph Dashboard API
    try:
        async with CephApiClient() as ceph:
            return await ceph.get(f"/api/rgw/user/{uid}")
    except Exception:
        return None


# ── Bucket listing with stats via Admin Ops API ──


async def list_rgw_buckets() -> list[dict]:
    """List all RGW buckets with their stats from the Admin Ops API.

    Returns a list of bucket dicts with ``bucket`` (name), ``usage``,
    ``num_objects``, ``owner``, etc.

    The Admin Ops API may return bucket names as strings or objects.
    We normalise to a list of dicts.
    """
    try:
        client = RGWAdminOpsClient()
        raw = await client.list_buckets(stats=True)
        result: list[dict] = []
        for item in raw:
            if isinstance(item, str):
                # Just a name — fetch the full detail
                detail = await client.get_bucket(item)
                if detail:
                    result.append(detail)
                else:
                    result.append({"bucket": item, "usage": {}, "num_objects": 0})
            elif isinstance(item, dict):
                result.append(item)
        return result
    except RGWAdminOpsError:
        pass

    # Fallback: Ceph Dashboard (names only, no stats)
    try:
        async with CephApiClient() as ceph:
            names = await ceph.get("/api/rgw/bucket")
            if isinstance(names, list):
                return [{"bucket": n, "usage": {}, "num_objects": 0} for n in names]
    except Exception:
        pass

    return []


async def get_rgw_bucket(bucket_name: str) -> dict | None:
    """Fetch a single bucket with stats from the Admin Ops API."""
    try:
        client = RGWAdminOpsClient()
        return await client.get_bucket(bucket_name)
    except RGWAdminOpsError:
        pass

    # Fallback: Ceph Dashboard
    try:
        async with CephApiClient() as ceph:
            return await ceph.get(f"/api/rgw/bucket/{bucket_name}")
    except Exception:
        return None


# ── User creation / deletion (Ceph Dashboard API) ──


async def create_rgw_user(uid: str, display_name: str) -> dict:
    """Create a new RGW user in Ceph via the Ceph Dashboard API.

    Returns the Ceph API response, which includes:
      - user_id / uid
      - keys: [{access_key, secret_key, user}]
      - ... (quota, buckets, etc.)
    """
    async with CephApiClient() as client:
        data = {
            "uid": uid,
            "display_name": display_name,
            "email": "",
            "max_buckets": 1000,
            "suspended": 0,
            "generate_key": True,
        }
        resp = await client.post("/api/rgw/user", json=data)
        return resp


async def delete_rgw_user(uid: str) -> None:
    """Delete an RGW user from Ceph via the Ceph Dashboard API."""
    async with CephApiClient() as client:
        await client.delete(f"/api/rgw/user/{uid}")


def extract_rgw_keys(response: dict) -> tuple[str, str] | None:
    """Pull access_key and secret_key from a Ceph RGW user response."""
    keys = response.get("keys", [])
    if keys:
        return keys[0].get("access_key", ""), keys[0].get("secret_key", "")
    return None


async def set_rgw_quota(
    uid: str, quota_type: str, enabled: bool, max_size_kb: int, max_objects: int
) -> None:
    """Set quota in Ceph via the Dashboard API.

    quota_type: 'user' or 'bucket'
    """
    async with CephApiClient() as client:
        await client.put(
            f"/api/rgw/user/{uid}/quota",
            json={
                "quota_type": quota_type,
                "enabled": "true" if enabled else "false",
                "max_size_kb": max_size_kb,
                "max_objects": str(max_objects),
            },
        )


async def set_rgw_ratelimit(
    uid: str,
    enabled: bool,
    max_read_ops: int,
    max_write_ops: int,
    max_read_bytes: int,
    max_write_bytes: int,
) -> None:
    """Set user rate limits in Ceph via the Dashboard API."""
    async with CephApiClient() as client:
        await client.put(
            f"/api/rgw/user/{uid}/ratelimit",
            json={
                "enabled": enabled,
                "max_read_ops": max_read_ops,
                "max_write_ops": max_write_ops,
                "max_read_bytes": max_read_bytes,
                "max_write_bytes": max_write_bytes,
            },
        )

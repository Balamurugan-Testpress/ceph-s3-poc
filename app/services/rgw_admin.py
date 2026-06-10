"""RGW admin operations via Ceph Dashboard REST API.

Creates and manages RGW users so we can provision S3 credentials
for our app users.
"""

from __future__ import annotations

from app.services.ceph_api import CephApiClient


async def create_rgw_user(uid: str, display_name: str) -> dict:
    """Create a new RGW user in Ceph.

    Returns the Ceph API response, which includes:
      - user_id / uid
      - keys: [{access_key, secret_key, user}]
      - ... (quota, buckets, etc.)
    """
    async with CephApiClient() as client:
        # The Ceph Dashboard API uses POST /api/rgw/user
        data = {
            "uid": uid,
            "display_name": display_name,
            "email": "",
            "max_buckets": 1000,
            "suspended": 0,
            "generate_key": True,
        }
        resp = await client.post("/api/rgw/user", json=data)
        # resp is already parsed JSON
        return resp


async def delete_rgw_user(uid: str) -> None:
    """Delete an RGW user from Ceph."""
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

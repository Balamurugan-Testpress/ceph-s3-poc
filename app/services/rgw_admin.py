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


async def set_rgw_user_quota(uid: str, quota_bytes: int, max_objects: int = -1) -> None:
    """Set a user-level quota in Ceph via the Dashboard API.

    ``quota_bytes`` is the max storage (in bytes). 0 disables quota.
    ``max_objects`` is the max object count. -1 for unlimited.

    The Ceph Dashboard API expects ``max_size_kb`` in KiB.
    """
    enabled = "true" if quota_bytes > 0 else "false"
    max_size_kb = max(0, quota_bytes // 1024) if quota_bytes > 0 else 0

    async with CephApiClient() as client:
        await client.put(
            f"/api/rgw/user/{uid}/quota",
            json={
                "quota_type": "user",
                "enabled": enabled,
                "max_size_kb": max_size_kb,
                "max_objects": str(max_objects),
            },
        )

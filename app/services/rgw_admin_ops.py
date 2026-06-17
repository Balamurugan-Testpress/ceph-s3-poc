"""RGW Admin Ops API client.

Talks directly to the RGW Admin Ops REST API (not the Ceph Dashboard).
This API runs alongside the S3 API on the RGW endpoint and provides
admin operations over users, buckets, quotas, etc.

Auth: AWS Signature V2 using the admin access/secret keys,
      passed as query string parameters (the format RGW Admin Ops
      expects across most Ceph versions).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx

from app.config import settings

logger = logging.getLogger("ceph-s3-poc")


class RGWAdminOpsError(Exception):
    """Raised when an RGW Admin Ops request fails."""


# ── helpers ──────────────────────────────────────────────────────


def _aws_v2_query_string_params(
    method: str,
    path: str,
    query_params: dict[str, str],
    access_key: str,
    secret_key: str,
) -> dict[str, str]:
    """Build query-string auth parameters for RGW Admin Ops.

    RGW Admin Ops uses AWS Signature V2 where the signing elements
    are passed as query parameters:
      ?AWSAccessKeyId={key}&Signature={sig}&Expires={timestamp}

    ``query_params`` are the *application* parameters (e.g. ``uid``,
    ``format``).  The canonical resource does **not** include them
    because they are not S3 sub-resources.  The auth params
    (AWSAccessKeyId, Signature, Expires) are appended *after* signing.
    """
    expires = str(int(datetime.now(timezone.utc).timestamp()) + 300)  # 5 min

    # AWS V2 CanonicalizedResource for query-string auth:
    #   path only — regular query params are NOT sub-resources and
    #   are excluded from the canonical resource.
    canonical_resource = path

    # AWS V2 StringToSign for query-string auth:
    #   StringToSign = HTTP-Verb + "\n"
    #                + Content-MD5 + "\n"
    #                + Content-Type + "\n"
    #                + Expires + "\n"
    #                + CanonicalizedResource
    #
    # Content-MD5 and Content-Type are empty strings for Admin Ops.
    string_to_sign = f"{method}\n\n\n{expires}\n{canonical_resource}"

    signature = base64.b64encode(
        hmac.new(
            secret_key.encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode()

    return {
        "AWSAccessKeyId": access_key,
        "Signature": signature,
        "Expires": expires,
    }


class RGWAdminOpsClient:
    """Async HTTP client for the RGW Admin Ops REST API."""

    def __init__(self) -> None:
        self.endpoint = settings.rgw_endpoint.rstrip("/")
        self.access_key = settings.rgw_access_key
        self.secret_key = settings.rgw_secret_key

    async def _request(self, method: str, path: str, params: dict | None = None) -> dict | list:
        """Make an AWS V2-signed request to the RGW Admin Ops API.

        Auth is passed as query-string parameters (``AWSAccessKeyId``,
        ``Signature``, ``Expires``) — the format natively understood by
        the RGW Admin Ops endpoint.
        """
        # ── Merge caller params with auth params ──
        request_params = dict(params or {})
        auth_params = _aws_v2_query_string_params(
            method,
            path,
            request_params,
            self.access_key,
            self.secret_key,
        )
        request_params.update(auth_params)

        url = f"{self.endpoint}{path}?{urlencode(request_params)}"

        # ── Fire request with Ceph API version header ──
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.request(
                    method,
                    url,
                    headers={"Accept": "application/vnd.ceph.api.v1.0+json"},
                )
        except httpx.RequestError as exc:
            raise RGWAdminOpsError(f"Request to RGW failed: {type(exc).__name__} - {exc}") from exc

        # Log the URL with all params except Signature (to avoid leaking secrets)
        redacted_params = {k: v for k, v in request_params.items() if k != "Signature"}
        logger.info(
            "RGW Admin Ops %s %s?%s → %s (len=%s)",
            method,
            f"{self.endpoint}{path}",
            urlencode(redacted_params),
            resp.status_code,
            len(resp.content),
        )

        if resp.status_code >= 400:
            raise RGWAdminOpsError(
                f"{method} {url} failed (HTTP {resp.status_code}): "
                f"{resp.text[:500]}"
            )

        if not resp.content:
            return {}

        try:
            return resp.json()
        except Exception as exc:
            raise RGWAdminOpsError(
                f"Failed to parse JSON response from {url}: {exc}\n"
                f"Raw: {resp.text[:500]}"
            ) from exc

    # ── Users ─────────────────────────────────────────────────────

    async def list_users(self) -> list[dict]:
        """List all RGW users.

        Returns a list. Items may be strings (UIDs) or dicts (user objects)
        depending on the Ceph version.  Callers should normalise.
        """
        data = await self._request("GET", "/admin/user", {"format": "json"})
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("users", [])
        return []

    async def get_user(self, uid: str, stats: bool = False) -> dict | None:
        """Get a single RGW user by UID.

        The response may be:
          - a dict with ``user_id`` (Ceph Admin Ops format) or ``uid``
          - a list containing one such dict
        """
        try:
            params = {"uid": uid, "format": "json"}
            if stats:
                params["stats"] = "True"
            data = await self._request("GET", "/admin/user", params)
            # Normalise: unwrap list
            if isinstance(data, list) and len(data) > 0:
                data = data[0]
            if isinstance(data, dict):
                # RGW Admin Ops returns ``user_id``, not ``uid``
                returned_uid = data.get("user_id") or data.get("uid")
                if returned_uid and str(returned_uid) == str(uid):
                    return data
            return None
        except RGWAdminOpsError as exc:
            logger.warning("get_user(%s) failed: %s", uid, exc)
            return None

    async def create_key(self, uid: str) -> list[dict]:
        """Generate a new S3 access/secret key pair for the user."""
        try:
            data = await self._request("PUT", "/admin/user", {
                "uid": uid,
                "key": "",
                "generate-key": "True",
                "format": "json"
            })
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                return data.get("keys", [])
            return []
        except RGWAdminOpsError as exc:
            logger.error("create_key(%s) failed: %s", uid, exc)
            raise

    async def delete_key(self, uid: str, access_key: str) -> bool:
        """Delete a specific S3 access key for a user."""
        try:
            await self._request("DELETE", "/admin/user", {
                "uid": uid,
                "key": "",
                "access-key": access_key,
                "format": "json"
            })
            return True
        except RGWAdminOpsError as exc:
            logger.error("delete_key(%s, %s) failed: %s", uid, access_key, exc)
            raise

    # ── Buckets ───────────────────────────────────────────────────

    async def list_buckets(self, stats: bool = False) -> list[dict]:
        """List all RGW buckets.

        If stats is True, passes stats=true to return full bucket details and stats.
        Returns a list. Items may be strings (bucket names) or dicts
        (bucket objects).  Callers should normalise.
        """
        params = {"format": "json"}
        if stats:
            params["stats"] = "true"
        data = await self._request("GET", "/admin/bucket", params)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("buckets", [])
        return []

    async def get_bucket(self, bucket_name: str) -> dict | None:
        """Get a single bucket with its stats."""
        try:
            data = await self._request("GET", "/admin/bucket", {"bucket": bucket_name, "format": "json"})
            if isinstance(data, list) and len(data) > 0:
                item = data[0]
                return item if isinstance(item, dict) else None
            if isinstance(data, dict):
                return data
            return None
        except RGWAdminOpsError as exc:
            logger.warning("get_bucket(%s) failed: %s", bucket_name, exc)
            return None

    # ── Rate limit ────────────────────────────────────────────────

    async def get_bucket_rate_limit(self, bucket: str) -> dict | None:
        """Fetch the per-bucket rate-limit configuration. Returns the
        ``bucket_ratelimit`` sub-dict or None if RGW reports no entry.
        Requires the ``ratelimit=read`` admin cap.
        """
        try:
            data = await self._request(
                "GET",
                "/admin/ratelimit",
                {"ratelimit-scope": "bucket", "bucket": bucket, "format": "json"},
            )
            if isinstance(data, dict):
                # Newer Ceph returns {bucket_ratelimit: {...}}; older returns the
                # config dict directly. Normalise both.
                return data.get("bucket_ratelimit", data)
            return None
        except RGWAdminOpsError as exc:
            logger.warning("get_bucket_rate_limit(%s) failed: %s", bucket, exc)
            return None

    async def set_bucket_rate_limit(
        self,
        bucket: str,
        *,
        enabled: bool,
        max_read_ops: int = 0,
        max_write_ops: int = 0,
        max_read_bytes: int = 0,
        max_write_bytes: int = 0,
    ) -> dict:
        """Apply a per-bucket rate limit via RGW Admin Ops.

        Gotcha worth flagging: rate limit uses **POST**, not PUT. Quota
        uses PUT — they look symmetrical but the verbs differ. Caller
        creds must hold the ``ratelimit=write`` admin cap; regular S3
        keys get 403.

        0 on any dimension means "no limit" for that metric.
        """
        params = {
            "ratelimit-scope": "bucket",
            "bucket": bucket,
            "enabled": "True" if enabled else "False",
            "max-read-ops": str(max_read_ops),
            "max-write-ops": str(max_write_ops),
            "max-read-bytes": str(max_read_bytes),
            "max-write-bytes": str(max_write_bytes),
            "format": "json",
        }
        data = await self._request("POST", "/admin/ratelimit", params)
        return data if isinstance(data, dict) else {"ok": True}

from __future__ import annotations

import asyncio
import logging

import httpx

from app.config import settings

logger = logging.getLogger("ceph-s3-poc")

_GLOBAL_TOKEN: str | None = None
_GLOBAL_TOKEN_LOCK = asyncio.Lock()


class CephApiError(Exception):
    """Raised when a Ceph API request fails."""


class CephApiClient:
    """Thin async REST client for the Ceph Dashboard API.

    Configuration is read from ``app.config.Settings`` (which draws from
    environment variables).
    """

    def __init__(self) -> None:
        self.base_url = settings.ceph_api_url.rstrip("/")
        self.username = settings.ceph_api_username
        self.password = settings.ceph_api_password
        verify = settings.ceph_api_verify_ssl

        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            verify=verify,
            timeout=30.0,
            headers={"Accept": "application/vnd.ceph.api.v1.0+json"},
            # Avoid connection-reuse issues with Ceph Dashboard (some versions
            # close connections unexpectedly after first request)
            limits=httpx.Limits(max_keepalive_connections=0),
        )


    async def authenticate(self) -> str:
        global _GLOBAL_TOKEN
        logger.info("Authenticating with Ceph Dashboard API as '%s'...", self.username)
        try:
            resp = await self._client.post(
                "/api/auth",
                json={"username": self.username, "password": self.password},
            )
        except httpx.RemoteProtocolError as exc:
            # Retry once — the Ceph Dashboard sometimes closes the connection
            # on the first attempt (connection reuse / SSL issue)
            logger.warning("Ceph auth failed (connection dropped), retrying once...")
            resp = await self._client.post(
                "/api/auth",
                json={"username": self.username, "password": self.password},
            )
        if resp.status_code not in (200, 201):
            raise CephApiError(
                f"Ceph auth failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )
        data = resp.json()
        token = data["token"]
        _GLOBAL_TOKEN = token
        self._client.headers["Authorization"] = f"Bearer {token}"
        logger.info("Authenticated with Ceph Dashboard API as '%s'", self.username)
        return token

    async def _ensure_auth(self) -> None:
        global _GLOBAL_TOKEN
        if _GLOBAL_TOKEN is None:
            async with _GLOBAL_TOKEN_LOCK:
                if _GLOBAL_TOKEN is None:
                    await self.authenticate()
        self._client.headers["Authorization"] = f"Bearer {_GLOBAL_TOKEN}"

    async def _reauthenticate(self) -> None:
        """Force re-authentication, clearing the old token first."""
        global _GLOBAL_TOKEN
        async with _GLOBAL_TOKEN_LOCK:
            _GLOBAL_TOKEN = None
            if "Authorization" in self._client.headers:
                del self._client.headers["Authorization"]
            await self.authenticate()


    async def get_health_minimal(self) -> dict:
        """Fetch cluster health, normalising across endpoint variants.

        Tries ``/api/health/minimal`` first (richer data with df, osd_map,
        client_perf), then falls back to ``/api/health/full`` (available in
        newer Ceph Dashboard versions).  Missing keys are filled in as empty
        defaults so callers always get a consistent shape.
        """
        await self._ensure_auth()
        data: dict = {}

        for path in ("/api/health/minimal", "/api/health/full"):
            resp = await self._client.get(path)
            if resp.status_code == 200:
                data = resp.json()
                logger.info("Ceph health endpoint %s returned data", path)
                break
            logger.warning("Ceph health endpoint %s returned %s", path, resp.status_code)

        if not data:
            raise CephApiError(
                "Health check failed — neither /api/health/minimal nor "
                "/api/health/full returned 200"
            )

        # Normalise: /api/health/full may lack df/osd_map/client_perf/hosts/rgw
        data.setdefault("df", {})
        data.setdefault("osd_map", {})
        data.setdefault("client_perf", {})
        data.setdefault("hosts", 0)
        data.setdefault("rgw", 0)
        return data

    async def get_monitor(self) -> dict:
        await self._ensure_auth()
        resp = await self._client.get("/api/monitor")
        if resp.status_code != 200:
            raise CephApiError(
                f"Monitor request failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )
        return resp.json()

    async def get_osds(self) -> list[dict]:
        await self._ensure_auth()
        resp = await self._client.get("/api/osd")
        if resp.status_code != 200:
            raise CephApiError(
                f"OSD request failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )
        return resp.json()

    async def get_pools(self) -> list[dict]:
        await self._ensure_auth()
        resp = await self._client.get("/api/pool")
        if resp.status_code != 200:
            raise CephApiError(
                f"Pool request failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )
        return resp.json()

    async def get_rgw_bucket_detail(self, bucket_name: str) -> dict:
        """Fetch detailed info for a single RGW bucket, including stats."""
        await self._ensure_auth()
        resp = await self._client.get(f"/api/rgw/bucket/{bucket_name}")
        if resp.status_code != 200:
            raise CephApiError(
                f"Bucket detail request failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )
        return resp.json()


    async def request(self, method: str, path: str, **kwargs) -> dict | list | None:
        """Generic authenticated request to Ceph Dashboard API.

        Automatically re-authenticates once if the server returns 401,
        handling token expiry transparently.
        """
        await self._ensure_auth()
        resp = await self._client.request(method, path, **kwargs)
        if resp.status_code == 401:
            # Token may have expired — re-authenticate and retry once
            logger.info("Ceph API returned 401 on %s %s — re-authenticating...", method, path)
            await self._reauthenticate()
            resp = await self._client.request(method, path, **kwargs)
        if resp.status_code >= 400:
            raise CephApiError(
                f"{method} {path} failed (HTTP {resp.status_code}): {resp.text[:300]}"
            )
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    async def get(self, path: str, **kwargs) -> dict | list:
        return await self.request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs) -> dict | list:
        return await self.request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs) -> dict | list | None:
        return await self.request("PUT", path, **kwargs)

    async def delete(self, path: str, **kwargs) -> dict | list:
        return await self.request("DELETE", path, **kwargs)


    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()

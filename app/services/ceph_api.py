from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("ceph-s3-poc")


class CephApiError(Exception):
    """Raised when a Ceph API request fails."""


class CephApiClient:
    """Thin async REST client for the Ceph Dashboard API.

    Reads configuration from environment variables:

    * ``CEPH_API_URL``       — base URL (default https://142.132.138.10:8443)
    * ``CEPH_API_USERNAME``  — dashboard admin username (default admin)
    * ``CEPH_API_PASSWORD``  — dashboard admin password (default testpress1$)
    * ``CEPH_API_VERIFY_SSL``— whether to verify TLS cert (default false)
    """

    def __init__(self) -> None:
        self.base_url = os.getenv("CEPH_API_URL", "https://142.132.138.10:8443").rstrip("/")
        self.username = os.getenv("CEPH_API_USERNAME", "admin")
        self.password = os.getenv("CEPH_API_PASSWORD", "testpress1$")
        verify = os.getenv("CEPH_API_VERIFY_SSL", "false").lower() in ("true", "1", "yes")

        self._token: str | None = None
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            verify=verify,
            timeout=30.0,
            headers={"Accept": "application/vnd.ceph.api.v1.0+json"},
        )


    async def authenticate(self) -> str:
        resp = await self._client.post(
            "/api/auth",
            json={"username": self.username, "password": self.password},
        )
        if resp.status_code not in (200, 201):
            raise CephApiError(
                f"Ceph auth failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )
        data = resp.json()
        self._token = data["token"]
        self._client.headers["Authorization"] = f"Bearer {self._token}"
        logger.info("Authenticated with Ceph Dashboard API as '%s'", self.username)
        return self._token

    async def _ensure_auth(self) -> None:
        if self._token is None:
            await self.authenticate()


    async def get_health_minimal(self) -> dict:
        await self._ensure_auth()
        resp = await self._client.get("/api/health/minimal")
        if resp.status_code != 200:
            raise CephApiError(
                f"Health check failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )
        return resp.json()

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


    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

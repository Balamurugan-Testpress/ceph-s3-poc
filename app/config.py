"""Centralized configuration for the Ceph S3 PoC application.

All environment-variable reading lives here so that URLs, credentials, and
other settings can be found and maintained in a single file.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    # ── Database ──
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://cephs3:cephs3@db:5432/cephs3",
        )
    )

    # ── Ceph Dashboard API ──
    ceph_api_url: str = field(
        default_factory=lambda: os.getenv(
            "CEPH_API_URL", "https://142.132.138.10:8443"
        )
    )
    ceph_api_username: str = field(
        default_factory=lambda: os.getenv("CEPH_API_USERNAME", "admin")
    )
    ceph_api_password: str = field(
        default_factory=lambda: os.getenv("CEPH_API_PASSWORD", "testpress1$")
    )
    ceph_api_verify_ssl: bool = field(
        default_factory=lambda: os.getenv("CEPH_API_VERIFY_SSL", "false").lower()
        in ("true", "1", "yes")
    )

    # ── RGW (S3) ──
    rgw_endpoint: str = field(
        default_factory=lambda: os.getenv(
            "RGW_ENDPOINT", "http://142.132.138.10:80"
        )
    )
    rgw_access_key: str = field(
        default_factory=lambda: os.getenv("RGW_ACCESS_KEY", "admin")
    )
    rgw_secret_key: str = field(
        default_factory=lambda: os.getenv("RGW_SECRET_KEY", "admin123")
    )

    # Origin that the dashboard is served from. Written into bucket CORS rules
    # so the browser is allowed to PUT multipart parts directly to RGW. Default
    # "*" keeps the docker-compose demo working without extra configuration; set
    # to your real origin (e.g. https://dashboard.example.com) in production.
    dashboard_origin: str = field(
        default_factory=lambda: os.getenv("DASHBOARD_ORIGIN", "*")
    )

    # ── App admin credentials ──
    admin_username: str = field(
        default_factory=lambda: os.getenv("ADMIN_USERNAME", "admin")
    )
    admin_password: str = field(
        default_factory=lambda: os.getenv("ADMIN_PASSWORD", "admin")
    )

    # ── JWT ──
    jwt_secret: str = field(
        default_factory=lambda: os.getenv("JWT_SECRET", "change-me-to-a-random-secret")
    )
    jwt_expire_hours: int = field(
        default_factory=lambda: int(os.getenv("JWT_EXPIRE_HOURS", "24"))
    )


# Module-level singleton for convenience.
settings = Settings()

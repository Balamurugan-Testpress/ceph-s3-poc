"""Ceph cluster status and log endpoints."""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter

from app.services.ceph_api import CephApiClient, CephApiError

router = APIRouter(prefix="/ceph", tags=["ceph"])

_STATUS_CACHE: dict | None = None
_STATUS_CACHE_TIME: float = 0.0
_STATUS_CACHE_LOCK = asyncio.Lock()
_STATUS_CACHE_TTL = 30.0  # 30 seconds to reduce Ceph API hits


def _normalize_osd(osd: dict) -> dict:
    """Normalize OSD fields so the frontend always gets consistent keys.

    The Ceph Dashboard API may return stats in different locations depending
    on the Ceph version.  We try several common paths.
    """
    osd_id = osd.get("id", osd.get("osd"))

    # ── hostname ──
    hostname = (
        osd.get("hostname")
        or osd.get("tree", {}).get("hostname")
        or osd.get("tree", {}).get("name")
        or ""
    )

    # ── weight ──
    weight = osd.get("weight", osd.get("crush_weight", 0))

    # ── state as a string ──
    # The API returns ``state`` as a list like ["exists", "up"]
    # but some versions return a single string like "up".
    raw_state = osd.get("state", [])
    state_list = raw_state if isinstance(raw_state, list) else [raw_state] if raw_state else []
    up = osd.get("up", "up" in state_list)
    in_cluster = osd.get("in", "in" in state_list)

    # ── size / used (try multiple paths) ──
    stats = osd.get("stats") or {}
    osd_stats = osd.get("osd_stats") or {}
    store_stats = osd.get("store_stats") or {}

    total_bytes = (
        stats.get("total_bytes")
        or osd_stats.get("total_bytes")
        or (osd_stats.get("kb") and osd_stats["kb"] * 1024)
        or store_stats.get("total_bytes")
        or 0
    )

    used_bytes = (
        stats.get("used_bytes")
        or osd_stats.get("used_bytes")
        or (osd_stats.get("kb_used") and osd_stats["kb_used"] * 1024)
        or store_stats.get("used_bytes")
        or 0
    )

    # ── utilization percentage ──
    utilization = osd.get("utilization")
    if utilization is None and total_bytes and used_bytes:
        utilization = (used_bytes / total_bytes) * 100

    return {
        "id": osd_id,
        "osd": osd_id,
        "hostname": hostname,
        "up": bool(up),
        "in": bool(in_cluster),
        "weight": float(weight) if weight else 0,
        "state": state_list,
        "total_bytes": int(total_bytes) if total_bytes else 0,
        "used_bytes": int(used_bytes) if used_bytes else 0,
        "utilization": float(utilization) if utilization is not None else None,
    }


def _normalize_pool(pool: dict) -> dict:
    """Normalize pool fields so the frontend gets consistent keys."""
    pool_name = pool.get("pool_name", pool.get("name", ""))
    pool_id = pool.get("pool", pool.get("id", 0))

    # Stats may be in ``stats`` sub-dict or at the top level
    stats = pool.get("stats") or {}

    pg_num = pool.get("pg_num", pool.get("pg_count", stats.get("pg_num", 0)))
    size = pool.get("size", pool.get("replicas", stats.get("size", 0)))

    # bytes used: try ``stats.bytes_used``, ``stats.kb_used``, top-level ``stats``
    bytes_used = (
        stats.get("bytes_used")
        or (stats.get("kb_used") and stats["kb_used"] * 1024)
        or pool.get("bytes_used", 0)
    )

    # object count
    objects = stats.get("objects", pool.get("objects", stats.get("num_objects", 0)))

    return {
        "id": pool_id,
        "pool_name": pool_name,
        "name": pool_name,
        "pg_num": int(pg_num) if pg_num else 0,
        "size": int(size) if size else 0,
        "bytes_used": int(bytes_used) if bytes_used else 0,
        "objects": int(objects) if objects else 0,
        "type": pool.get("type", pool.get("pool_type", "replicated")),
    }


@router.get("/status")
async def cluster_status():
    """Return aggregated cluster status from the Ceph Dashboard API.

    Combines health-minimal, OSD list, pool list, and monitor info into
    a single response so the frontend can show a rich detail view.
    All OSD and pool data is normalised to predictable field names.
    Individual component failures are handled gracefully so partial
    data is still returned.
    """
    global _STATUS_CACHE, _STATUS_CACHE_TIME
    now = time.time()
    if _STATUS_CACHE is not None and (now - _STATUS_CACHE_TIME) < _STATUS_CACHE_TTL:
        return _STATUS_CACHE

    async with _STATUS_CACHE_LOCK:
        # Double check inside lock
        now = time.time()
        if _STATUS_CACHE is not None and (now - _STATUS_CACHE_TIME) < _STATUS_CACHE_TTL:
            return _STATUS_CACHE

        client = CephApiClient()
        result: dict = {}
        errors: list[str] = []
        try:
            health_task = asyncio.create_task(client.get_health_minimal())
            osds_task = asyncio.create_task(client.get_osds())
            pools_task = asyncio.create_task(client.get_pools())
            monitor_task = asyncio.create_task(client.get_monitor())

            health, raw_osds, raw_pools, monitor = await asyncio.gather(
                health_task, osds_task, pools_task, monitor_task, return_exceptions=True
            )

            if isinstance(health, Exception):
                errors.append(f"health: {health}")
                result.update(health={}, df={}, osd_map={}, client_perf={}, hosts=0, rgw=0)
            else:
                health_checks = health.get("health", {}).get("checks", health.get("checks", {}))
                if isinstance(health_checks, list):
                    health["checks"] = {
                        str(i): check for i, check in enumerate(health_checks)
                    }
                elif isinstance(health_checks, dict):
                    health["checks"] = health_checks
                result["health"] = health.get("health", health)
                result["df"] = health.get("df", {})
                result["osd_map"] = health.get("osd_map", {})
                result["client_perf"] = health.get("client_perf", {})
                result["hosts"] = health.get("hosts", 0)
                result["rgw"] = health.get("rgw", 0)

            # ── OSDs ──
            if isinstance(raw_osds, Exception):
                errors.append(f"osds: {raw_osds}")
                result["osds"] = []
                result["osd_summary"] = {"total": 0, "up": 0, "down": 0, "in": 0, "out": 0}
            else:
                osds = [_normalize_osd(o) for o in raw_osds]
                result["osds"] = osds
                result["osd_summary"] = {
                    "total": len(osds),
                    "up": sum(1 for o in osds if o["up"]),
                    "down": sum(1 for o in osds if not o["up"]),
                    "in": sum(1 for o in osds if o["in"]),
                    "out": sum(1 for o in osds if not o["in"]),
                }

            # ── Pools ──
            if isinstance(raw_pools, Exception):
                errors.append(f"pools: {raw_pools}")
                result["pools"] = []
            else:
                result["pools"] = [_normalize_pool(p) for p in raw_pools]

            # ── Monitors ──
            if isinstance(monitor, Exception):
                errors.append(f"monitors: {monitor}")
                result["monitors"] = []
            else:
                monitor_list: list[dict] = []
                if isinstance(monitor, list):
                    monitor_list = monitor
                elif isinstance(monitor, dict):
                    monitor_list = monitor.get("monitors", monitor.get("monmap", []))
                    if not monitor_list and ("in_quorum" in monitor or "name" in monitor):
                        monitor_list = [monitor]
                result["monitors"] = monitor_list

            response_data = {
                "connected": bool(result.get("health")) or not errors,
                "error": "; ".join(errors) if errors else None,
                "data": result,
            }
            # Only cache if we successfully connected to at least some components
            if response_data["connected"]:
                _STATUS_CACHE = response_data
                _STATUS_CACHE_TIME = now
            return response_data
        except Exception as exc:
            return {
                "connected": False,
                "error": str(exc),
                "data": None,
            }
        finally:
            await client.close()


@router.get("/logs")
async def ceph_logs():
    """Fetch cluster event/audit logs from the Ceph Dashboard API.

    Returns a list of recent log entries from the Ceph cluster.
    """
    client = CephApiClient()
    try:
        data = await client.get("/api/log")
        return {"connected": True, "error": None, "logs": data if isinstance(data, list) else []}
    except CephApiError as exc:
        return {"connected": False, "error": str(exc), "logs": []}
    finally:
        await client.close()




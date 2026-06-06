from fastapi import APIRouter

from app.services.ceph_api import CephApiClient, CephApiError

router = APIRouter(prefix="/ceph", tags=["ceph"])


@router.get("/status")
async def cluster_status():
    client = CephApiClient()
    try:
        data = await client.get_health_minimal()
        return {
            "connected": True,
            "error": None,
            "data": data,
        }
    except CephApiError as exc:
        return {
            "connected": False,
            "error": str(exc),
            "data": None,
        }
    finally:
        await client.close()

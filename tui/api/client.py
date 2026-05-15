import httpx

BASE_URL = "http://localhost:8000"


async def get_health():
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/health")
        return response.json()

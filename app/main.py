from fastapi import FastAPI

app = FastAPI(title="Ceph S3 PoC")


@app.get("/health")
async def health():
    return {"status": "ok"}

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.ceph import router as ceph_router
from app.api.rgw import router as rgw_router

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

logger = logging.getLogger("ceph-s3-poc")

app = FastAPI(title="Ceph S3 PoC")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(ceph_router, prefix="/api")
app.include_router(rgw_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}

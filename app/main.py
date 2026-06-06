"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import engine
from app.db.models import Base

logger = logging.getLogger("ceph-s3-poc")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created / verified")
    yield
    # Shutdown: dispose engine
    await engine.dispose()


app = FastAPI(title="Ceph S3 PoC", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routers ──
from app.api.auth import router as auth_router
from app.api.ceph import router as ceph_router
from app.api.rgw import router as rgw_router
from app.api.s3 import router as s3_router
from app.api.admin import router as admin_router

app.include_router(auth_router)
app.include_router(ceph_router, prefix="/api")
app.include_router(rgw_router, prefix="/api")
app.include_router(s3_router, prefix="/api")
app.include_router(admin_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}

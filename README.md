# Ceph S3 PoC

A lightweight dashboard for a live Ceph cluster — cluster health, bucket listing, and object browsing. Everything runs in Docker.

```bash
docker compose up --build
```

Open **http://localhost:5173** → login with `admin` / `admin`.

---

## Documentation

| Doc | What it covers |
|-----|---------------|
| [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) | Architecture, data flow, component relationships, the two API conversations |
| [docs/API.md](docs/API.md) | All REST endpoints with request/response examples |
| [docs/SETUP.md](docs/SETUP.md) | Setup, Docker commands, troubleshooting |

---

## Quick Reference

```
2 Docker containers:
  ceph-s3-api        :8000    FastAPI backend
  ceph-s3-frontend   :5173    React dashboard

5 API endpoints:
  POST /auth/login                 → login
  GET  /api/ceph/status            → cluster health
  GET  /api/rgw/buckets            → list S3 buckets
  GET  /api/rgw/buckets/{n}/objects → list objects in a bucket
  GET  /health                     → app health

1 .env file with 10 variables:
  CEPH_API_*    → Ceph Dashboard API credentials
  RGW_*         → RGW S3 admin credentials
  ADMIN_*       → dashboard login
  JWT_SECRET    → JWT signing key
```

No database. No external services. Just the cluster's own APIs.

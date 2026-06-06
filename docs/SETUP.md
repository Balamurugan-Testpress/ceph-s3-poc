# Setup Guide

## Requirements

- Docker + Docker Compose (or Podman)
- Git
- A browser

No Python, Node.js, or any other tools needed on the host — everything runs inside containers.

---

## Quick Start

```bash
# 1. Clone the repo (if you haven't already)
cd /path/to/ceph-s3-poc

# 2. Start everything
docker compose up --build
```

This builds and starts 2 containers:
- `ceph-s3-api` on port 8000
- `ceph-s3-frontend` on port 5173

Open **http://localhost:5173** in your browser.

---

## Login

| Field | Default |
|-------|---------|
| Username | `admin` |
| Password | `admin` |

---

## What You'll See

1. **Cluster Status** — health (OK/WARN/ERR), OSD count, storage usage, client I/O
2. **Buckets & Objects** — click a bucket name in the left sidebar to see its objects

---

## Environment Variables

All configuration is in `.env` at the project root:

```bash
# ── Ceph Dashboard API ──
CEPH_API_URL=https://142.132.138.10:8443    # Cluster's dashboard API
CEPH_API_USERNAME=admin                     # Dashboard login
CEPH_API_PASSWORD=testpress1$               # Dashboard password
CEPH_API_VERIFY_SSL=false                   # Self-signed cert

# ── RGW S3 API ──
RGW_ENDPOINT=http://142.132.138.10:80       # S3-compatible endpoint
RGW_ACCESS_KEY=admin                        # S3 access key
RGW_SECRET_KEY=admin123                     # S3 secret key

# ── App Login ──
ADMIN_USERNAME=admin                        # Your dashboard login
ADMIN_PASSWORD=admin                        # Your dashboard password
JWT_SECRET=change-me-to-a-random-secret     # JWT signing key
```

To change any value, edit `.env` and restart:
```bash
docker compose down
docker compose up -d
```

---

## Docker Commands

```bash
# Start (build first, then run in background)
docker compose up --build -d

# Start (without rebuilding)
docker compose up -d

# View logs
docker compose logs -f
docker compose logs -f api
docker compose logs -f frontend

# Stop
docker compose down

# Stop + delete volumes (wipes nothing — no database)
docker compose down -v

# Rebuild a specific service
docker compose build api
docker compose build frontend

# Rebuild and start fresh
docker compose down && docker compose up --build -d
```

---

## Testing the API

Once the containers are running, you can test from your terminal:

```bash
# Health
curl http://localhost:8000/health

# Login
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Cluster status
curl http://localhost:8000/api/ceph/status \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# List buckets
curl http://localhost:8000/api/rgw/buckets \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# List objects
curl "http://localhost:8000/api/rgw/buckets/testpress/objects?max_keys=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## Development (without Docker)

If you want to run outside Docker:

```bash
# Backend
cd ceph-s3-poc
python3 -m venv .venv
source .venv/bin/activate
pip install uv
uv pip install -r <(uv export --no-hashes)
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173.

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Login returns 401 | Wrong credentials in `.env` | Check `ADMIN_USERNAME` / `ADMIN_PASSWORD` |
| Cluster status shows disconnected | Ceph Dashboard API unreachable | Check `CEPH_API_URL` and network connectivity |
| Buckets show "Not authorized" | Wrong S3 credentials | Check `RGW_ACCESS_KEY` / `RGW_SECRET_KEY` |
| Port already in use | Another service on :8000 or :5173 | Stop the other service or change the port in docker-compose.yml |
| Frontend shows blank page | Build cache issue | `docker compose build --no-cache frontend` |
| "Network ceph-s3-poc_default not found" | Orphan containers | `docker compose down -v && docker compose up -d` |

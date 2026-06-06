# How This System Works

## Overview

A two-container Docker setup that connects a React dashboard to a live Ceph cluster. The backend translates between browser-friendly JSON APIs and the cluster's native protocols (Ceph Dashboard REST API + S3 API).

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Browser                             │
│                     http://localhost:5173                        │
│                                                                  │
│   React App (SPA)                                               │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  LoginPage  ──▶  AuthContext  ──▶  localStorage (JWT)   │   │
│   │                                                          │   │
│   │  Dashboard                                               │   │
│   │   ├── ClusterStatus    ◀── GET /api/ceph/status          │   │
│   │   └── BucketExplorer   ◀── GET /api/rgw/buckets          │   │
│   │                         ◀── GET /api/rgw/buckets/X/obj   │   │
│   └──────────────────────┬──────────────────────────────────┘   │
└──────────────────────────┼──────────────────────────────────────┘
                           │
              Vite Dev Server (port 5173)
              Proxies /api/*, /auth/*, /health/* to api:8000
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Docker: ceph-s3-api (port 8000)                     │
│                                                                  │
│   FastAPI                                                        │
│                                                                  │
│   ┌──────────┐   ┌──────────────────────┐   ┌────────────────┐  │
│   │  Auth     │   │  Ceph Health         │   │  RGW Buckets   │  │
│   │  /login   │   │  /api/ceph/status    │   │  /api/rgw/*    │  │
│   │           │   │                      │   │                │  │
│   │  checks   │   │  CephApiClient       │   │  RGWClient     │  │
│   │  env vars │   │  (httpx)             │   │  (boto3)       │  │
│   └──────────┘   └─────────┬────────────┘   └───────┬────────┘  │
│                             │                         │           │
│                             ▼                         ▼           │
│                    ┌──────────────┐          ┌──────────────┐     │
│                    │  Ceph        │          │  RGW S3      │     │
│                    │  Dashboard   │          │  Endpoint    │     │
│                    │  REST API    │          │  port 80     │     │
│                    │  port 8443   │          │  S3 XML      │     │
│                    │  JSON        │          │              │     │
│                    └──────────────┘          └──────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Two Conversations

The backend holds **two independent conversations** with the Ceph cluster:

### Conversation 1: Cluster Health (Ceph Dashboard API)

```
GET /api/ceph/status
       │
       ▼
  CephApiClient.authenticate()
       │  POST https://142.132.138.10:8443/api/auth
       │  Accept: application/vnd.ceph.api.v1.0+json
       │  Body: {"username": "admin", "password": "testpress1$"}
       │
       ▼  Returns: {"token": "eyJ...", "username": "admin", ...}
       │
  CephApiClient.get_health_minimal()
       │  GET https://142.132.138.10:8443/api/health/minimal
       │  Authorization: Bearer eyJ...
       │  Accept: application/vnd.ceph.api.v1.0+json
       │
       ▼  Returns:
         {
           "health": { "status": "HEALTH_OK" },
           "df": { "stats": { "total_bytes": ..., ... } },
           "osd_map": { "osds": [...] },
           "hosts": 2,
           "rgw": 2,
           "client_perf": { ... }
         }
```

The Ceph Dashboard API is the **same API the Ceph web UI uses**. It returns JSON. The backend authenticates once, gets a JWT, then reuses it for all subsequent calls. If the token expires (24h), the next request fails and a new one is obtained.

### Conversation 2: Bucket & Object Listing (RGW S3 API)

```
GET /api/rgw/buckets
       │
       ▼
  RGWClient.list_buckets()
       │  boto3.client("s3", endpoint_url="http://142.132.138.10:80",
       │                aws_access_key_id="admin",
       │                aws_secret_access_key="admin123")
       │
       ▼  Returns:
         [
           { "name": "testpress", "creation_date": "2026-06-03 ..." }
         ]


GET /api/rgw/buckets/testpress/objects?max_keys=100
       │
       ▼
  RGWClient.list_objects("testpress", max_keys=100)
       │  s3.list_objects_v2(Bucket="testpress", MaxKeys=100)
       │
       ▼  Returns:
         {
           "objects": [
             { "key": "server1-video-2001.mp4", "size": 5604073472, ... },
             ...
           ],
           "is_truncated": true,
           "key_count": 100
         }
```

This uses the **S3 API** (AWS S3-compatible XML over HTTP) via `boto3`. The admin S3 credentials (`admin` / `admin123`) are from the Ceph cluster itself — they're the RGW admin user keys.

---

## Auth Flow (our app's own login)

```
Browser                        Backend
   │                              │
   │  POST /auth/login            │
   │  {username, password}        │
   │                              │
   │                              ├── read ADMIN_USERNAME, ADMIN_PASSWORD from env
   │                              ├── compare (plain string comparison)
   │                              ├── if match: create JWT with HS256, 24h expiry
   │                              │
   │  ← {access_token, user}      │
   │                              │
   │  store token in localStorage │
   │  (key: "ceph_s3_auth")       │
   │                              │
   │  GET /api/ceph/status        │
   │  Authorization: Bearer ...   │
   │                              │
   │                              ├── decode JWT, verify signature
   │                              ├── check role == "admin"
   │                              ├── forward to CephApiClient
   │                              │
   │  ← {connected, data}         │
```

No database involved. Admin credentials live in `.env`. The JWT token is the only thing that proves you're logged in.

---

## Frontend Component Tree

```
<App>
  <Routes>
    <Route path="/login">
      <LoginPage />                 ← login form

    <Route path="/*">
      <ProtectedRoute>              ← redirects to /login if no token
        <Dashboard>
          <header>
            Sign Out button
            user greeting

          <ClusterStatus />          ← auto-refreshes every 15s
            └─ health cards
            └─ OSD count
            └─ storage usage
            └─ client I/O

          <BucketExplorer />         ← interactive
            ├─ sidebar: bucket list
            └─ main: object table
        </Dashboard>
      </ProtectedRoute>
  </Routes>
</App>
```

---

## State Management

| What | Where | How it works |
|------|-------|-------------|
| Auth token | `localStorage` key `ceph_s3_auth` | Stored on login, cleared on logout/401 |
| Auth context | React `AuthContext` | Provides `{user, loading, login, logout}` to all components |
| Cluster status | `ClusterStatus` component state | Fetched every 15s via `apiFetch("/api/ceph/status")` |
| Bucket list | `BucketExplorer` component state | Fetched once on mount |
| Object list | `BucketExplorer` component state | Fetched when user clicks a bucket |

---

## The `.env` File — What Each Variable Does

| Variable | Used By | Purpose |
|----------|---------|---------|
| `CEPH_API_URL` | `CephApiClient` | Where to reach the Ceph Dashboard API |
| `CEPH_API_USERNAME` | `CephApiClient` | Dashboard login user |
| `CEPH_API_PASSWORD` | `CephApiClient` | Dashboard login password |
| `CEPH_API_VERIFY_SSL` | `CephApiClient` | Whether to verify TLS (self-signed → false) |
| `RGW_ENDPOINT` | `RGWClient` | RGW S3 endpoint (usually port 80) |
| `RGW_ACCESS_KEY` | `RGWClient` | S3 access key for admin user |
| `RGW_SECRET_KEY` | `RGWClient` | S3 secret key for admin user |
| `ADMIN_USERNAME` | `app/api/auth.py` | Our own app's admin login |
| `ADMIN_PASSWORD` | `app/api/auth.py` | Our own app's admin password |
| `JWT_SECRET` | `app/auth/jwt.py` | Key for signing JWTs |

---

## File Relationships

```
.env  ──────────────▶  app/services/ceph_api.py    (reads CEPH_API_*)
                  │
                  ├──▶  app/services/rgw_client.py  (reads RGW_*)
                  │
                  ├──▶  app/api/auth.py             (reads ADMIN_*)
                  │
                  └──▶  app/auth/jwt.py             (reads JWT_SECRET)


app/main.py  ──────▶  includes routers:

  app/api/auth.py   ──▶  app/auth/jwt.py           (create JWT)
  app/api/ceph.py   ──▶  app/services/ceph_api.py  (httpx → Ceph REST)
  app/api/rgw.py    ──▶  app/services/rgw_client.py (boto3 → S3 API)
  app/api/deps.py   ──▶  app/auth/jwt.py           (verify JWT)


frontend/src/main.jsx  ──▶  <App/>
  App.jsx                ──▶  <Routes>
  AuthContext.jsx        ──▶  login(), logout()
  api/client.js          ──▶  fetch() with JWT injection
```

---

## Container Startup Sequence

```
1. docker compose up --build

2. Docker builds images:
   - ceph-s3-api:    python:3.12-slim + FastAPI + boto3 + httpx
   - ceph-s3-frontend: node:22-slim + React + Vite

3. Containers start:
   - ceph-s3-api:     uvicorn app.main:app --host 0.0.0.0 --port 8000
   - ceph-s3-frontend: npm run dev -- --host 0.0.0.0 (port 5173)

4. User opens http://localhost:5173

5. Vite proxy configuration:
   /api/*  ──▶  http://api:8000/api/*
   /auth/* ──▶  http://api:8000/auth/*
   /health ──▶  http://api:8000/health

6. Login page loads → user submits credentials
   POST /auth/login → returns JWT → stored in localStorage

7. Dashboard loads → ClusterStatus calls GET /api/ceph/status
   ↳ CephApiClient authenticates with Ceph Dashboard API
   ↳ Returns cluster health data
   ↳ Rendered as health cards + storage + I/O stats

8. User clicks a bucket in BucketExplorer
   GET /api/rgw/buckets/testpress/objects?max_keys=100
   ↳ RGWClient calls S3 ListObjectsV2
   ↳ Returns object list
   ↳ Rendered as a table
```

---

## No Database — Why?

The original project used PostgreSQL + Tortoise ORM to store users, tenants, buckets, and RGW credentials. For this PoC, all of that is unnecessary:

- **Auth**: Admin credentials in `.env` — one user, compared directly
- **RGW credentials**: In `.env` — one set of admin S3 keys
- **Bucket metadata**: Fetched live from the cluster via S3 API

This makes the system **stateless**: restart the container and everything works the same. No volumes, no migrations, no connection pooling.

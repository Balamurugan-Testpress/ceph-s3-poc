# API Reference

All endpoints (except login) require an `Authorization: Bearer <token>` header.
Get a token by calling `POST /auth/login`.

---

## App Health

```
GET /health
```

No auth required. Returns `{"status": "ok"}`.

---

## Authentication

### Login

```
POST /auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin"
}
```

Success response (200):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user": {
    "id": "admin",
    "username": "admin",
    "role": "admin",
    "display_name": "Administrator"
  }
}
```

Failure response (401):
```json
{
  "detail": "Invalid Credentials"
}
```

---

## Cluster Status

### Ceph cluster health

```
GET /api/ceph/status
Authorization: Bearer <token>
```

Fetches live health data from the Ceph Dashboard API at `https://142.132.138.10:8443`.

Success (200):
```json
{
  "connected": true,
  "error": null,
  "data": {
    "health": {
      "status": "HEALTH_OK",
      "checks": [],
      "mutes": []
    },
    "osd_map": {
      "osds": [
        { "osd": 0, "up": 1, "in": 1, "state": ["exists", "up"], ... },
        ...
      ]
    },
    "df": {
      "stats": {
        "total_bytes": 96005378801664,
        "total_used_raw_bytes": 64392225132544,
        "total_avail_bytes": 31613153669120
      }
    },
    "hosts": 2,
    "rgw": 2,
    "client_perf": {
      "read_bytes_sec": 82021,
      "read_op_per_sec": 110,
      "write_bytes_sec": 191049096,
      "write_op_per_sec": 102
    },
    "mon_status": { ... },
    "pools": [ ... ]
  }
}
```

Failure (200, but `connected` is false):
```json
{
  "connected": false,
  "error": "Unable to reach Ceph Dashboard API: ...",
  "data": null
}
```

---

## RGW S3 Buckets & Objects

These endpoints talk directly to the RGW S3 API at `http://142.132.138.10:80`
using admin S3 credentials from `RGW_ACCESS_KEY` / `RGW_SECRET_KEY`.

### List all buckets

```
GET /api/rgw/buckets
Authorization: Bearer <token>
```

Response (200):
```json
{
  "buckets": [
    {
      "name": "testpress",
      "creation_date": "2026-06-03 11:54:32.474000+00:00"
    }
  ]
}
```

### List objects in a bucket

```
GET /api/rgw/buckets/{bucket_name}/objects
Authorization: Bearer <token>
```

Optional query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_keys` | int | 100 | Objects per page (max 1000) |
| `fetch_all` | bool | false | Paginate through all objects server-side |
| `continuation_token` | string | null | Token from previous page for manual pagination |

Examples:

```
# First page (100 objects)
GET /api/rgw/buckets/testpress/objects

# Specific page size
GET /api/rgw/buckets/testpress/objects?max_keys=20

# Fetch all objects (paginates internally, may be slow for large buckets)
GET /api/rgw/buckets/testpress/objects?fetch_all=true

# Manual pagination — first page returns next_token
GET /api/rgw/buckets/testpress/objects?max_keys=50
# → response includes next_token, use it to get the next page:
GET /api/rgw/buckets/testpress/objects?max_keys=50&continuation_token=<next_token>
```

Response — page (200):
```json
{
  "objects": [
    {
      "key": "server1-video-2001.mp4",
      "size": 5604073472,
      "last_modified": "2026-06-04 04:32:36+00:00"
    },
    {
      "key": "server1-video-2002.mp4",
      "size": 5604073472,
      "last_modified": "2026-06-04 04:32:41+00:00"
    }
  ],
  "is_truncated": true,
  "key_count": 100,
  "next_token": "server1-video-2005.mp4",
  "bucket": "testpress"
}
```

Response — fetch_all (200):
```json
{
  "objects": [ ... all objects ... ],
  "total_count": 7789,
  "bucket": "testpress"
}
```

- `is_truncated`: `true` if there are more objects beyond `max_keys`
- `key_count`: number of objects in this page
- `next_token`: pass as `continuation_token` to get the next page
- `total_count`: total objects (only with `fetch_all=true`)
- `size`: in bytes

---

## Quick Test Commands

```bash
# 1. Login and save the token
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Health check
curl http://localhost:8000/health

# 3. Cluster status
curl http://localhost:8000/api/ceph/status -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 4. List buckets
curl http://localhost:8000/api/rgw/buckets -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 5. List objects (first 10)
curl "http://localhost:8000/api/rgw/buckets/testpress/objects?max_keys=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## Ceph Dashboard API (External — used internally)

The backend communicates with these endpoints on the Ceph cluster:

| Method | Path | Version Header | Purpose |
|--------|------|---------------|---------|
| POST | `/api/auth` | `v1.0` | Get JWT token |
| GET | `/api/health/minimal` | `v1.0` | Cluster health summary |
| GET | `/api/monitor` | `v1.0` | Monitor daemon status |
| GET | `/api/osd` | `v1.0` | OSD list |
| GET | `/api/pool` | `v1.0` | Pool list |
| GET | `/api/rgw/user` | `v1.0` | RGW users |
| GET | `/api/rgw/bucket` | `v1.0` | RGW buckets |
| GET | `/api/rgw/user/{id}` | `v1.0` | User details + S3 keys |
| GET | `/api/rgw/bucket/{name}` | `v1.0` | Bucket details |
| GET | `/api/user` | `v1.0` | Dashboard users |

Version header format: `Accept: application/vnd.ceph.api.v1.0+json`

```bash
# Direct call example
curl -X POST https://142.132.138.10:8443/api/auth \
  -H "Content-Type: application/json" \
  -H "Accept: application/vnd.ceph.api.v1.0+json" \
  -d '{"username":"admin","password":"testpress1$"}'
```


# Ceph S3 PoC

A lightweight multi-tenant S3 platform PoC powered by Ceph RGW, FastAPI, PostgreSQL, Redis, and a Textual TUI.

---

## Stack

- FastAPI
- Textual TUI
- PostgreSQL
- Redis
- Ceph RGW
- Docker Compose
- uv

---

## Requirements

- Python 3.12+
- Docker
- Docker Compose
- uv

---

## Start Backend Services

Start:

- FastAPI
- PostgreSQL
- Redis

```bash
docker compose up --build
````

Backend API:

```text
http://localhost:8000
```

Health check:

```text
http://localhost:8000/health
```

---

## Run TUI

Run locally:

```bash
uv run python -m tui.app
```

---

## Project Structure

```text
app/    -> FastAPI backend
tui/    -> Textual terminal UI
```

---

## Current PoC Goals

* Tenant management
* Bucket lifecycle
* RGW integration
* S3 credential generation
* Usage tracking
* Textual-based infra TUI

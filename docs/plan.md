# Ceph S3 PoC V1 Plan

## Goal

Build a multi-tenant object storage control plane on top of Ceph RGW with:

- Tenant management
- Bucket lifecycle management
- S3-compatible access
- Usage tracking
- Quota visibility
- Cost estimation
- TUI-based management interface

---

## High-Level Architecture

```text
Tenant/Admin TUI
        ↓
     FastAPI
        ↓
 Control Plane Logic
        ↓
     Ceph RGW
        ↓
       Ceph
```

---

## Core Flows

### Tenant Lifecycle

```text
Admin creates tenant
↓
Tenant receives credentials
↓
Tenant logs into TUI
```

---

### Bucket Lifecycle

```text
Tenant creates bucket
↓
Bucket metadata stored
↓
Bucket provisioned in RGW
↓
Tenant manages bucket lifecycle
```

---

### S3 Access Flow

```text
Tenant receives S3 credentials
↓
Tenant uploads using aws-cli / SDK
↓
RGW handles object operations
↓
Usage metrics updated
```

---

### Usage and Cost Flow

```text
Usage collected from RGW
↓
Usage aggregated in backend
↓
Quota and estimated cost displayed
```

---

## Functional Areas

### Admin

- Create tenants
- Manage tenants
- View cluster state
- View global usage

---

### Tenant

- Create buckets
- Delete buckets
- View usage
- View quotas
- View estimated costs
- Manage credentials

---

## PoC Success Criteria

```text
Tenant creation works
↓
Bucket creation works
↓
S3 upload works
↓
Usage updates correctly
↓
Quota visible
↓
Estimated cost visible
↓
Bucket lifecycle manageable through TUI
```

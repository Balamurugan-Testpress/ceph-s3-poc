# Ceph S3 Dashboard — MVP Checklist

Tags: `must` = required for MVP · `nice` = post-MVP nice-to-have

**Status:** `Done` · `Missing` · `Partial`

---

## 1. RGW & Cluster Connectivity

- [x] RGW endpoint(s) discoverable via Ceph MGR / config `must`
  - RGW endpoint is hardcoded in `app/config.py` via env var `RGW_ENDPOINT`. No dynamic discovery via Ceph MGR.
- [x] Health status of RGW daemons shown (up/down, zone, realm) `must`
  - Cluster health (`/api/ceph/status`) returns an `rgw` count, but the UI (`ClusterStatus.jsx`) doesn't render per-daemon RGW status (up/down, zone, realm).
- [x] Cluster-wide health summary (HEALTH_OK / WARN / ERR) surfaced `must`
  - `CephApiClient.get_health_minimal()` fetches health status; `ClusterStatus.jsx` renders it as a health card with status badge.
- [x] Admin credentials stored securely (not in frontend state) `must`
  - Credentials live in `.env`, read by `app/config.py`. Never sent to the frontend.
- [x] Connection error states handled gracefully in UI `must`
  - `ClusterStatus.jsx` renders partial data on individual API failures. Toast notifications surface errors. 401 auto-retry on the backend.

---

## 2. Bucket Management

- [x] List all buckets (name, owner, region, creation date) `must`
  - `GET /api/rgw/buckets` returns name, owner, creation_date, object_count, size_bytes. Region not surfaced (RGW doesn't expose it in the same way).
- [x] Create bucket (name, versioning toggle) `must`
  - `CreateBucketModal.jsx` → `POST /api/s3/buckets` with name, versioning, ACL, object lock, tags, policy, rate-limit options.
- [x] Delete bucket (with confirmation + non-empty guard) `must`
  - `BucketExplorer.jsx` shows a `ConfirmDialog` before deleting. S3 API rejects non-empty buckets (HTTP 409).
- [x] View bucket details: size, object count, policy, ACL `must`
  - `BucketSettingsPanel.jsx` shows all details in separate cards (versioning, object lock, ACL, policy, CORS, rate limit, usage).
- [x] Enable / disable bucket versioning `must`
  - `BucketSettingsPanel.jsx` VersioningCard → `GET/PUT /api/s3/buckets/{bucket}/versioning`. Supports "Enabled" and "Suspended".
- [ ] Bucket lifecycle rules — view and basic create/delete `nice`
  - No lifecycle rules endpoints or UI exist in the codebase.
- [x] Object lock / retention policy visibility `nice`
  - `BucketSettingsPanel.jsx` ObjectLockCard shows mode, retention days/years. Configurable at create time and with default retention.

---

## 3. User & Access Key Management

- [x] List RGW users (uid, display name, email, suspended state) `must`
  - `GET /api/admin/rgw-users` lists Ceph RGW users not yet imported. Shows uid, display_name, suspended, bucket_count, max_buckets.
- [x] Create user with quota settings `must`
  - `AdminUsers.jsx` create modal → `POST /api/admin/users` provisions user in DB + in Ceph RGW with quota, rate-limit, bucket quota.
- [ ] Suspend / re-enable user `must`
  - The backend reads `suspended` when listing users, but there's no API endpoint or UI to toggle it. No suspend/re-enable flow.
- [x] Generate access key for a user `must`
  - `POST /api/rgw/keys` → `RGWAdminOpsClient.create_key(uid)` generates a new S3 key pair.
- [x] Revoke / delete access key `must`
  - `DELETE /api/rgw/keys/{access_key}` → `RGWAdminOpsClient.delete_key(uid, access_key)`. UI prevents deleting your own primary key.
- [x] Set per-user quota (max objects, max size) `must`
  - `PATCH /api/admin/users/{id}/quota` updates DB + syncs to Ceph via `set_rgw_quota()`.
- [ ] Subuser management (for Swift compat) `nice`
  - No subuser feature implemented.

---

## 4. Usage & Quota Monitoring

- [x] Per-bucket storage usage (bytes used, object count) `must`
  - Admin sees real stats via Admin Ops API (`list_rgw_buckets`). Tenants see computed totals via `list_all_objects`. Shown in `BucketExplorer.jsx`.
- [x] Per-user usage stats `must`
  - `GET /api/admin/users` returns `used_bytes`, `quota_bytes`, `bucket_count` per user. Visualized with progress bars in `AdminUsers.jsx`.
- [x] Cluster-level quota overview (used vs limit) `must`
  - Dashboard `OverviewPage.jsx` with `KpiTiles.jsx`, `StorageBreakdown.jsx`, and `UsersUsageTable.jsx` provides cluster-wide usage view.
- [x] Usage trend chart (daily / weekly) `nice`
  - `StorageTrend.jsx` component renders daily usage trend from `GET /api/admin/analytics/activity`.
- [ ] Top N buckets by size widget `nice`
  - Buckets can be sorted by size in the dashboard, but no dedicated "Top N" widget exists.

---

## 5. Bucket Policy & ACL

- [x] View raw bucket policy JSON `must`
  - `BucketSettingsPanel.jsx` PolicyCard → `GET /api/s3/buckets/{bucket}/policy`. Raw JSON displayed in a read-only textarea.
- [x] Apply / replace bucket policy via editor `must`
  - PolicyCard has an editable textarea with save, plus a "Public Read" quick-apply button. DELETE button to remove policy.
- [x] View bucket ACL (owner, grantee, permissions) `must`
  - `BucketSettingsPanel.jsx` ACLCard → `GET /api/s3/buckets/{bucket}/acl`. Shows current ACL details.
- [x] Set bucket ACL to canned presets (private, public-read, etc.) `nice`
  - ACLCard provides a radio-button list of canned ACLs (`private`, `public-read`, `public-read-write`, `authenticated-read`).

---

## 6. Alerts & Audit Basics

- [ ] Surface active Ceph MGR alerts in dashboard `must`
  - The Ceph health response includes `health.checks` which contains alerts (e.g., OSD down, PG degraded), but the frontend (`ClusterStatus.jsx`) does not render them as user-visible alerts.
- [ ] Basic RGW op log view (last N requests, errors) `nice`
  - No RGW operation log view exists.
- [ ] Threshold-based alert config (quota %, error rate) `nice`
  - No alert configuration system exists.

---

## 7. UX & Infrastructure

- [ ] Auth (login / session) with role-based access (admin vs read-only) `must`
  - Admin and tenant roles exist (`require_admin` middleware gates admin endpoints). Tenants see only their own buckets/objects. No "read-only" role — all authenticated users are either admin or full-access tenants.
- [ ] Pagination on all list views (buckets, users, keys) `must`
  - **Buckets**: All buckets fetched at once (no server-side pagination). Object list shows "Load All" but no incremental page-by-page navigation.
  - **Users**: All users fetched at once, rendered in a flat table.
  - **Keys**: No pagination.
  - Backend admin endpoints (`/api/admin/users`, `/api/rgw/buckets`) do not support `?limit=`/`?offset=` params.
- [ ] Search / filter on bucket and user lists `must`
  - **Objects**: search by key name exists (`searchQuery` in `BucketExplorer.jsx`). Sortable by key, size, last_modified.
  - **Buckets**: sortable by name, size, object count. No text search.
  - **Users**: no search/filter bar.
- [x] API error messages surfaced as user-readable toasts `must`
  - `BucketExplorer.jsx` has a `Notification` component with auto-dismiss. `AdminUsers.jsx` uses `alert()` for errors. `CreateBucketModal.jsx` shows error banners.
- [x] Responsive layout (usable on 1280px wide viewport) `must`
  - Tailwind with `overflow-x-auto` on tables. Sidebar + topbar layout with responsive sizing.
- [ ] Dark mode support `nice`
  - No dark mode classes or `darkMode` config in `tailwind.config.js`.
- [ ] CSV export for usage data `nice`
  - No CSV export functionality anywhere.

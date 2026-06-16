import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function formatCompact(num) {
  if (!num) return "0";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
  return String(num);
}

function Notification({ type, message, onDismiss }) {
  const bg = type === "error" ? "bg-red-100 text-red-800" :
             type === "success" ? "bg-green-100 text-green-800" :
             "bg-blue-100 text-blue-800";
  return (
    <div className={`${bg} text-xs px-3 py-2 rounded flex items-center justify-between gap-2`}>
      <span>{message}</span>
      <button onClick={onDismiss} className="font-bold opacity-60 hover:opacity-100">&times;</button>
    </div>
  );
}

function SortIcon({ active, direction }) {
  if (!active) return <span className="text-gray-300 ml-1">↕</span>;
  return <span className="text-blue-600 ml-1">{direction === "asc" ? "↑" : "↓"}</span>;
}

function ShareLinkDialog({ bucket, objectKey, onClose, addNotification }) {
  const PRESETS = [
    { label: "5 min",   seconds: 300 },
    { label: "1 hour",  seconds: 3600 },
    { label: "24 hours", seconds: 86400 },
    { label: "7 days",  seconds: 604800 },
  ];
  const [seconds, setSeconds] = useState(3600);
  const [customMode, setCustomMode] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(60);
  const [result, setResult] = useState(null); // { url, expires_in, expires_at }
  const [loading, setLoading] = useState(false);

  async function generate() {
    const expires_in = customMode ? Math.round(customMinutes * 60) : seconds;
    setLoading(true);
    try {
      const data = await apiFetch(
        `/api/rgw/buckets/${bucket}/objects/${encodeURI(objectKey)}/presign`,
        { method: "POST", body: JSON.stringify({ expires_in }) },
      );
      setResult(data);
    } catch (err) {
      addNotification("error", `Failed to generate link: ${err.message}`);
    }
    setLoading(false);
  }

  async function copy() {
    // navigator.clipboard requires HTTPS or localhost. On plain-HTTP prod it
    // throws — fall back to selecting the text so the user can Cmd-C.
    try {
      await navigator.clipboard.writeText(result.url);
      addNotification("success", "Link copied to clipboard");
    } catch {
      const input = document.getElementById("share-link-url");
      if (input) {
        input.focus();
        input.select();
      }
      addNotification("info", "Press Cmd/Ctrl-C to copy");
    }
  }

  const expiresAtLabel = result?.expires_at
    ? new Date(result.expires_at).toLocaleString()
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Share Link</h3>
        <p className="text-xs text-gray-500 mb-4 font-mono break-all">{objectKey}</p>

        {!result ? (
          <>
            <p className="text-xs text-gray-600 mb-2">Link expires after:</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PRESETS.map(p => {
                const active = !customMode && seconds === p.seconds;
                return (
                  <button
                    key={p.seconds}
                    onClick={() => { setCustomMode(false); setSeconds(p.seconds); }}
                    className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                      active
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                onClick={() => setCustomMode(true)}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  customMode
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
              >
                Custom…
              </button>
            </div>

            {customMode && (
              <div className="flex items-center gap-2 mb-3 text-xs text-gray-600">
                <input
                  type="number"
                  min="1"
                  max="10080"
                  value={customMinutes}
                  onChange={e => setCustomMinutes(Number(e.target.value))}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                />
                <span>minutes (max 10080 = 7 days)</span>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={onClose}
                disabled={loading}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={generate}
                disabled={loading || (customMode && (!customMinutes || customMinutes < 1))}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? "Generating…" : "Generate Link"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-600 mb-2">
              Expires {expiresAtLabel ? <>at <strong>{expiresAtLabel}</strong></> : `in ${result.expires_in}s`}.
            </p>
            <div className="flex gap-2 mb-3">
              <input
                id="share-link-url"
                type="text"
                readOnly
                value={result.url}
                onFocus={e => e.target.select()}
                className="flex-1 px-2 py-1.5 text-xs font-mono border border-gray-300 rounded bg-gray-50 text-gray-700"
              />
              <button
                onClick={copy}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-gray-400 italic mb-4">
              Anyone with this URL can download the object until it expires. Treat it like a password.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setResult(null)}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              >
                New link
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded bg-gray-800 text-white hover:bg-gray-900"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, onConfirm, onCancel, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
          >
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BucketExplorer() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [bucketTab, setBucketTab] = useState("objects"); // "objects" or "settings"
  const [policyText, setPolicyText] = useState("");
  const [accessLevel, setAccessLevel] = useState("private"); // "private", "public", "custom"
  const [objects, setObjects] = useState([]);
  const [objectInfo, setObjectInfo] = useState(null);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [objSelected, setObjSelected] = useState(new Set());
  const [deletingObjs, setDeletingObjs] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [bucketSort, setBucketSort] = useState("name");
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { type: 'bucket'|'object', data }
  const [shareTarget, setShareTarget] = useState(null); // { bucket, key } when share modal open

  const addNotification = useCallback((type, message) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

  const { data: bucketsData, isLoading: loadingBuckets, refetch: fetchBuckets } = useQuery({
    queryKey: ["buckets"],
    queryFn: () => apiFetch("/api/rgw/buckets"),
  });
  const buckets = bucketsData?.buckets || [];

  const { data: usage } = useQuery({
    queryKey: ["s3Usage"],
    queryFn: () => apiFetch("/api/s3/usage"),
    staleTime: 60000,
  });

  const { data: policyData, isLoading: loadingPolicy } = useQuery({
    queryKey: ["bucketPolicy", selected],
    queryFn: () => apiFetch(`/api/s3/buckets/${selected}/policy`),
    enabled: !!selected && bucketTab === "settings",
  });

  const putPolicyMutation = useMutation({
    mutationFn: (policy) => apiFetch(`/api/s3/buckets/${selected}/policy`, {
      method: "PUT",
      body: JSON.stringify({ policy }),
    }),
    onSuccess: () => {
      addNotification("success", "Bucket policy updated");
      queryClient.invalidateQueries(["bucketPolicy", selected]);
    },
    onError: (err) => addNotification("error", err.message),
  });

  const deletePolicyMutation = useMutation({
    mutationFn: () => apiFetch(`/api/s3/buckets/${selected}/policy`, { method: "DELETE" }),
    onSuccess: () => {
      addNotification("success", "Bucket policy removed");
      setPolicyText("");
      queryClient.invalidateQueries(["bucketPolicy", selected]);
    },
    onError: (err) => addNotification("error", err.message),
  });

  // Keep policyText in sync with loaded data
  useEffect(() => {
    if (policyData?.policy !== undefined) {
      const p = policyData.policy;
      setPolicyText(p || "");
      if (!p) {
        setAccessLevel("private");
      } else {
        try {
          const parsed = JSON.parse(p);
          const isPublic = parsed.Statement?.some(s => 
            s.Effect === "Allow" && 
            s.Principal === "*" && 
            (s.Action === "s3:GetObject" || (Array.isArray(s.Action) && s.Action.includes("s3:GetObject")))
          );
          setAccessLevel(isPublic ? "public" : "custom");
        } catch {
          setAccessLevel("custom");
        }
      }
    }
  }, [policyData]);

  const getPublicPolicy = (bucketName) => {
    return JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: "*",
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${bucketName}/*`]
        }
      ]
    }, null, 2);
  };

  const handleAccessChange = (level) => {
    if (level === accessLevel) return;
    setAccessLevel(level);
    if (level === "public") {
      const p = getPublicPolicy(selected);
      setPolicyText(p);
      putPolicyMutation.mutate(p);
    } else if (level === "private") {
      setPolicyText("");
      if (policyData?.policy) {
        deletePolicyMutation.mutate();
      }
    }
  };

  // ── Open bucket ──
  async function openBucket(name) {
    setSelected(name);
    setBucketTab("objects");
    setObjects([]);
    setLoadingObjects(true);
    setObjectInfo(null);
    setObjSelected(new Set());
    setSearchQuery("");
    setSortKey(null);
    try {
      const data = await apiFetch(`/api/rgw/buckets/${name}/objects?max_keys=100`);
      setObjects(data.objects || []);
      setObjectInfo({
        count: data.key_count || 0,
        total: data.key_count || 0,
        truncated: data.is_truncated || false,
        nextToken: data.next_token,
      });
    } catch (err) {
      addNotification("error", `Failed to load objects: ${err.message}`);
    }
    setLoadingObjects(false);
  }

  // ── Fetch all objects ──
  async function fetchAll(bucket) {
    setLoadingObjects(true);
    try {
      const data = await apiFetch(`/api/rgw/buckets/${bucket}/objects?fetch_all=true`);
      setObjects(data.objects || []);
      setObjectInfo({ count: data.total_count, total: data.total_count, truncated: false });
    } catch (err) {
      addNotification("error", `Failed to load all objects: ${err.message}`);
    }
    setLoadingObjects(false);
  }

  // ── Create bucket ──
  async function handleCreateBucket() {
    const name = newBucketName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await apiFetch("/api/s3/buckets", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      addNotification("success", `Bucket "${name}" created`);
      setNewBucketName("");
      setShowCreateInput(false);
      await fetchBuckets();
    } catch (err) {
      addNotification("error", `Failed to create bucket: ${err.message}`);
    }
    setCreating(false);
  }

  // ── Delete bucket ──
  async function handleDeleteBucket(name) {
    setConfirmDelete({ type: "bucket", data: name });
  }

  async function confirmDeleteBucket(name) {
    setConfirmDelete(null);
    setLoadingObjects(true);
    try {
      await apiFetch(`/api/s3/buckets/${name}`, { method: "DELETE" });
      addNotification("success", `Bucket "${name}" deleted`);
      if (selected === name) {
        setSelected(null);
        setObjects([]);
        setObjectInfo(null);
      }
      await fetchBuckets();
    } catch (err) {
      addNotification("error", `Failed to delete bucket: ${err.message}`);
    }
    setLoadingObjects(false);
  }

  // ── Upload file ──
  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiFetch(`/api/s3/buckets/${selected}/upload`, {
        method: "POST",
        body: formData,
      });
      addNotification("success", `"${file.name}" uploaded`);
      // Reload objects
      await openBucket(selected);
    } catch (err) {
      addNotification("error", `Upload failed: ${err.message}`);
    }
    setUploading(false);
    e.target.value = "";
  }

  // ── Selection ──
  function toggleObj(key) {
    setObjSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllObjs() {
    if (objSelected.size === objects.length) {
      setObjSelected(new Set());
    } else {
      setObjSelected(new Set(objects.map(o => o.key)));
    }
  }

  // ── Bulk delete ──
  async function handleBulkDelete() {
    if (objSelected.size === 0) return;
    setConfirmDelete({ type: "objects", data: Array.from(objSelected) });
  }

  async function confirmBulkDelete(keys) {
    setConfirmDelete(null);
    if (keys.length === 0) return;
    setDeletingObjs(true);
    try {
      await apiFetch(`/api/rgw/buckets/${selected}/objects/bulk-delete`, {
        method: "POST",
        body: JSON.stringify({ keys }),
      });
      const kept = objects.filter(o => !keys.includes(o.key));
      setObjects(kept);
      setObjSelected(new Set());
      setObjectInfo(prev => prev ? { ...prev, count: kept.length, total: kept.length } : null);
      addNotification("success", `Deleted ${keys.length} object(s)`);
    } catch (err) {
      addNotification("error", `Bulk delete failed: ${err.message}`);
    }
    setDeletingObjs(false);
  }

  // ── Single delete ──
  function handleDelete(bucket, key) {
    setConfirmDelete({ type: "object", data: { bucket, key } });
  }

  async function confirmDeleteObject(bucket, key) {
    setConfirmDelete(null);
    try {
      await apiFetch(`/api/rgw/buckets/${bucket}/objects/${encodeURI(key)}`, { method: "DELETE" });
      setObjects(prev => prev.filter(o => o.key !== key));
      setObjSelected(prev => { const next = new Set(prev); next.delete(key); return next; });
      addNotification("success", `"${key}" deleted`);
    } catch (err) {
      addNotification("error", `Delete failed: ${err.message}`);
    }
  }

  // ── Download ──
  async function handleDownload(bucket, key) {
    try {
      const data = await apiFetch(`/api/rgw/buckets/${bucket}/objects/${encodeURI(key)}/download`);
      window.open(data.url, "_blank");
    } catch (err) {
      addNotification("error", `Download failed: ${err.message}`);
    }
  }

  // ── Sorting ──
  function handleSort(column) {
    if (sortKey === column) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(column);
      setSortDir("asc");
    }
  }

  // ── Derived data ──
  const totalUsedInBuckets = buckets.reduce((sum, b) => sum + (b.size_bytes || 0), 0);

  const sortedBuckets = [...buckets].sort((a, b) => {
    let cmp = 0;
    if (bucketSort === "name") cmp = a.name.localeCompare(b.name);
    else if (bucketSort === "size") cmp = (a.size_bytes || 0) - (b.size_bytes || 0);
    else if (bucketSort === "objects") cmp = (a.object_count || 0) - (b.object_count || 0);
    return cmp;
  });

  const filteredObjects = objects.filter(o =>
    !searchQuery || o.key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedObjects = [...filteredObjects].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "key") cmp = a.key.localeCompare(b.key);
    else if (sortKey === "size") cmp = (a.size || 0) - (b.size || 0);
    else if (sortKey === "last_modified") cmp = (a.last_modified || "").localeCompare(b.last_modified || "");
    return sortDir === "asc" ? cmp : -cmp;
  });

  // ── Usage bar ──
  const isUnlimited = usage && usage.quota_bytes <= 0;
  const usagePct = usage ? (isUnlimited ? 0 : Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100)) : 0;
  const barColor = usagePct > 90 ? "bg-red-500" : usagePct > 70 ? "bg-yellow-400" : "bg-blue-500";

  // ── Render ──
  if (loadingBuckets) return <div className="text-gray-500 italic py-8 text-center">Loading buckets…</div>;

  return (
    <div>
      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="mb-3 space-y-1">
          {notifications.map(n => (
            <Notification key={n.id} {...n} onDismiss={() => setNotifications(prev => prev.filter(x => x.id !== n.id))} />
          ))}
        </div>
      )}

      {/* Usage bar (non-admin users) */}
      {usage && !usage.is_admin && (
        <div className="mb-4 bg-gray-50 rounded-lg p-3">
          <div className={`flex justify-between items-center w-full text-xs text-gray-500 ${isUnlimited ? '' : 'mb-1'}`}>
            <span className="inline-flex items-center gap-1">
              <span>Storage Usage:</span>
              <span className="font-medium text-gray-700">{formatBytes(usage.used_bytes)}</span>
              {isUnlimited && <span> used</span>}
              {!isUnlimited && <span> / {formatBytes(usage.quota_bytes)}</span>}
            </span>
            <span>
              {isUnlimited ? (
                <span className="italic text-gray-400">No limit</span>
              ) : (
                <span>{usagePct.toFixed(0)}%</span>
              )}
            </span>
          </div>
          {!isUnlimited && (
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden mt-1">
              <div className={`h-full ${barColor} rounded-full transition-all duration-300`} style={{ width: `${usagePct}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 min-h-[200px]">
        {/* Sidebar */}
        <div className="w-full md:w-56 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="m-0 text-sm text-gray-500 font-medium">
              Buckets
              <span className="ml-1 text-xs text-gray-400">({buckets.length})</span>
            </h3>
            <div className="flex gap-1">
              <button
                onClick={() => { fetchBuckets(); }}
                title="Refresh buckets"
                className="px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-500 hover:bg-gray-100"
              >
                ↻
              </button>
              <button
                onClick={() => { setShowCreateInput(!showCreateInput); setNewBucketName(""); }}
                title="Create bucket"
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                + New
              </button>
            </div>
          </div>

          {showCreateInput && (
            <div className="flex gap-1 mb-2">
              <input
                type="text"
                value={newBucketName}
                onChange={e => setNewBucketName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreateBucket()}
                placeholder="bucket-name"
                className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                autoFocus
                disabled={creating}
              />
              <button
                onClick={handleCreateBucket}
                disabled={creating || !newBucketName.trim()}
                className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
              >
                {creating ? "..." : "OK"}
              </button>
            </div>
          )}

          {/* Bucket sort controls */}
          <div className="flex gap-1 mb-2 text-xs text-gray-400">
            <button
              onClick={() => setBucketSort("name")}
              className={`px-1.5 py-0.5 rounded ${bucketSort === "name" ? "bg-gray-200 text-gray-700" : "hover:bg-gray-100"}`}
            >
              Name
            </button>
            <button
              onClick={() => setBucketSort("size")}
              className={`px-1.5 py-0.5 rounded ${bucketSort === "size" ? "bg-gray-200 text-gray-700" : "hover:bg-gray-100"}`}
            >
              Size
            </button>
            <button
              onClick={() => setBucketSort("objects")}
              className={`px-1.5 py-0.5 rounded ${bucketSort === "objects" ? "bg-gray-200 text-gray-700" : "hover:bg-gray-100"}`}
            >
              Objects
            </button>
          </div>

          {buckets.length === 0 && <p className="text-gray-400 italic text-sm">No buckets yet. Create one!</p>}
          <div className="max-h-[50vh] overflow-y-auto space-y-0.5 pr-1">
            {sortedBuckets.map(b => {
              const isActive = selected === b.name;
              const objCount = b.object_count || 0;
              const sizeBytes = b.size_bytes || 0;
              return (
                <div
                  key={b.name}
                  className={`group relative px-3 py-2 rounded cursor-pointer text-sm transition-colors ${
                    isActive
                      ? "bg-blue-100 border border-blue-200"
                      : "border border-transparent hover:bg-gray-100"
                  }`}
                  onClick={() => openBucket(b.name)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all text-gray-800 font-medium truncate">{b.name}</span>
                    {isActive && (
                      <button
                        title="Delete bucket"
                        onClick={e => { e.stopPropagation(); handleDeleteBucket(b.name); }}
                        className="shrink-0 px-1 text-xs text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-gray-400 truncate">
                      {formatBytes(sizeBytes)}
                      {objCount > 0 && <> &middot; {formatCompact(objCount)} obj</>}
                    </span>
                    <div className="h-1.5 w-16 bg-gray-200 rounded-full overflow-hidden shrink-0">
                      <div
                        className="h-full bg-blue-400 rounded-full"
                        style={{
                          width: totalUsedInBuckets > 0
                            ? `${Math.max(3, (sizeBytes / totalUsedInBuckets) * 100)}%`
                            : "0%",
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {!selected && (
            <div className="flex items-center justify-center h-48 text-gray-400 italic">
              Select a bucket to browse objects
            </div>
          )}

          {selected && (
            <>
              {/* Header bar */}
              <div className="mb-3 text-sm text-gray-600 flex items-center gap-2 flex-wrap">
                <strong className="text-gray-800">{selected}</strong>
                {objectInfo && bucketTab === "objects" && <span className="text-gray-400">— {objectInfo.count.toLocaleString()} object{(objectInfo.count || 0) !== 1 ? "s" : ""}</span>}
                {(() => {
                  const b = buckets.find(x => x.name === selected);
                  if (b?.size_bytes) {
                    return <span className="text-xs text-gray-400">({formatBytes(b.size_bytes)})</span>;
                  }
                  return null;
                })()}
                {objectInfo?.truncated && (
                  <>
                    <span className="text-amber-600 italic text-xs">(showing first 100)</span>
                    <button
                      onClick={() => fetchAll(selected)}
                      disabled={loadingObjects}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loadingObjects ? "Loading…" : "Load All"}
                    </button>
                  </>
                )}
                <div className="flex-1" />
                {/* Upload button */}
                <label className={`px-2 py-1 text-xs rounded cursor-pointer ${uploading ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"} text-white disabled:opacity-60`}>
                  {uploading ? "Uploading…" : "Upload"}
                  <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
                {bucketTab === "objects" && objSelected.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={deletingObjs}
                    className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {deletingObjs ? "Deleting…" : `Delete ${objSelected.size}`}
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 mb-4 gap-4">
                <button
                  onClick={() => setBucketTab("objects")}
                  className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                    bucketTab === "objects" ? "border-brand-500 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  Objects
                </button>
                <button
                  onClick={() => setBucketTab("settings")}
                  className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                    bucketTab === "settings" ? "border-brand-500 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  Settings & Policy
                </button>
              </div>

              {bucketTab === "objects" ? (
                <>
                  {/* Search */}
              {objects.length > 0 && (
                <div className="mb-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Filter objects by name…"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:border-blue-400"
                  />
                </div>
              )}

              {/* Loading */}
              {loadingObjects && (
                <div className="flex items-center justify-center h-32 text-gray-500 italic">
                  <span className="animate-pulse">Fetching objects…</span>
                </div>
              )}

              {/* Objects table */}
              {!loadingObjects && sortedObjects.length > 0 && (
                <div className="max-h-[60vh] overflow-y-auto border border-gray-300 rounded">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-gray-600 font-semibold border-b-2 border-gray-300 sticky top-0 bg-white z-10">
                        <th className="p-2 w-10">
                          <input
                            type="checkbox"
                            onChange={toggleAllObjs}
                            checked={objSelected.size === objects.length && objects.length > 0}
                            className="m-0 cursor-pointer"
                          />
                        </th>
                        <th className="p-2 cursor-pointer hover:bg-gray-100 select-none" onClick={() => handleSort("key")}>
                          Key <SortIcon active={sortKey === "key"} direction={sortDir} />
                        </th>
                        <th className="p-2 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap" onClick={() => handleSort("size")}>
                          Size <SortIcon active={sortKey === "size"} direction={sortDir} />
                        </th>
                        <th className="p-2 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap" onClick={() => handleSort("last_modified")}>
                          Last Modified <SortIcon active={sortKey === "last_modified"} direction={sortDir} />
                        </th>
                        <th className="p-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedObjects.map(obj => (
                        <tr
                          key={obj.key}
                          className={`border-b border-gray-200 hover:bg-gray-50 transition-colors ${
                            objSelected.has(obj.key) ? "bg-yellow-50" : ""
                          }`}
                        >
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={objSelected.has(obj.key)}
                              onChange={() => toggleObj(obj.key)}
                              className="m-0 cursor-pointer"
                            />
                          </td>
                          <td className="p-2 font-mono break-all max-w-[300px] text-xs">{obj.key}</td>
                          <td className="p-2 whitespace-nowrap text-gray-600">{formatBytes(obj.size)}</td>
                          <td className="p-2 whitespace-nowrap text-gray-500 text-xs">
                            {obj.last_modified?.slice(0, 19)?.replace("T", " ")}
                          </td>
                          <td className="p-2 whitespace-nowrap text-right">
                            <button
                              title="Download"
                              onClick={() => handleDownload(selected, obj.key)}
                              className="px-1.5 py-1 border border-gray-300 rounded bg-white text-blue-600 text-xs cursor-pointer hover:bg-blue-50 mr-1 transition-colors"
                            >
                              ⬇
                            </button>
                            <button
                              title="Share link"
                              onClick={() => setShareTarget({ bucket: selected, key: obj.key })}
                              className="px-1.5 py-1 border border-gray-300 rounded bg-white text-gray-600 text-xs cursor-pointer hover:bg-gray-50 mr-1 transition-colors"
                            >
                              🔗
                            </button>
                            <button
                              title="Delete"
                              onClick={() => handleDelete(selected, obj.key)}
                              className="px-1.5 py-1 border border-gray-300 rounded bg-white text-red-600 text-xs cursor-pointer hover:bg-red-50 transition-colors"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!loadingObjects && sortedObjects.length === 0 && objects.length > 0 && (
                <div className="text-gray-400 italic py-8 text-center">
                  No objects match "{searchQuery}"
                </div>
              )}

              {!loadingObjects && objects.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                  <p className="italic mb-2">This bucket is empty</p>
                  <label className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700 transition-colors">
                    Upload first file
                    <input type="file" className="hidden" onChange={handleUpload} />
                  </label>
                </div>
              )}
                </>
              ) : (
                <div className="space-y-4 max-w-3xl">
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">Access Level</h3>
                    <p className="text-xs text-gray-500 mb-4">
                      Control whether this bucket is completely private or accessible to everyone on the internet.
                    </p>
                    {loadingPolicy ? (
                      <div className="text-sm text-gray-400 italic">Loading policy...</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex gap-6">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="accessLevel"
                              value="private"
                              checked={accessLevel === "private"}
                              onChange={() => handleAccessChange("private")}
                              className="text-brand-500 focus:ring-brand-500"
                            />
                            <span className="text-sm font-medium text-gray-800">Private</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="accessLevel"
                              value="public"
                              checked={accessLevel === "public"}
                              onChange={() => handleAccessChange("public")}
                              className="text-brand-500 focus:ring-brand-500"
                            />
                            <span className="text-sm font-medium text-gray-800">Public (Read-Only)</span>
                          </label>
                          {accessLevel === "custom" && (
                            <label className="flex items-center gap-2 cursor-pointer opacity-50">
                              <input
                                type="radio"
                                name="accessLevel"
                                value="custom"
                                checked
                                readOnly
                                className="text-brand-500 focus:ring-brand-500"
                              />
                              <span className="text-sm font-medium text-gray-800">Custom Policy</span>
                            </label>
                          )}
                        </div>

                        {accessLevel === "custom" && (
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <p className="text-xs text-gray-500 mb-2 font-medium">Raw JSON Policy (Advanced)</p>
                            <textarea
                              value={policyText}
                              onChange={(e) => setPolicyText(e.target.value)}
                              className="w-full h-48 px-3 py-2 text-sm font-mono border border-gray-300 rounded bg-white focus:outline-none focus:border-brand-400"
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => putPolicyMutation.mutate(policyText)}
                                disabled={!policyText.trim() || putPolicyMutation.isLoading}
                                className="px-3 py-1.5 text-xs bg-brand-500 text-white rounded hover:bg-brand-600 disabled:opacity-60"
                              >
                                {putPolicyMutation.isLoading ? "Saving..." : "Save Custom Policy"}
                              </button>
                            </div>
                          </div>
                        )}
                        {(putPolicyMutation.isLoading || deletePolicyMutation.isLoading) && (
                          <div className="text-xs text-brand-600 italic">Updating permissions...</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {confirmDelete?.type === "bucket" && (
        <ConfirmDialog
          title="Delete Bucket"
          message={`Are you sure you want to delete "${confirmDelete.data}"? The bucket must be empty.`}
          onConfirm={() => confirmDeleteBucket(confirmDelete.data)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmDelete?.type === "object" && (
        <ConfirmDialog
          title="Delete Object"
          message={`Delete "${confirmDelete.data.key}"?`}
          onConfirm={() => confirmDeleteObject(confirmDelete.data.bucket, confirmDelete.data.key)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmDelete?.type === "objects" && (
        <ConfirmDialog
          title="Delete Objects"
          message={`Delete ${confirmDelete.data.length} selected object(s)?`}
          onConfirm={() => confirmBulkDelete(confirmDelete.data)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {shareTarget && (
        <ShareLinkDialog
          bucket={shareTarget.bucket}
          objectKey={shareTarget.key}
          onClose={() => setShareTarget(null)}
          addNotification={addNotification}
        />
      )}
    </div>
  );
}

export default BucketExplorer;

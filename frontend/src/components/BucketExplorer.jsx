import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import "./BucketExplorer.css";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function BucketExplorer() {
  const [buckets, setBuckets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [objects, setObjects] = useState([]);
  const [objectInfo, setObjectInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [objSelected, setObjSelected] = useState(new Set());
  const [deletingObjs, setDeletingObjs] = useState(false);

  useEffect(() => {
    apiFetch("/api/rgw/buckets")
      .then((data) => setBuckets(data.buckets))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function openBucket(name) {
    setSelected(name);
    setObjects([]);
    setLoadingObjects(true);
    setObjectInfo(null);
    setObjSelected(new Set());
    try {
      const data = await apiFetch(`/api/rgw/buckets/${name}/objects?max_keys=100`);
      setObjects(data.objects);
      setObjectInfo({
        count: data.key_count,
        total: data.key_count,
        truncated: data.is_truncated,
        nextToken: data.next_token,
      });
    } catch (_) {}
    setLoadingObjects(false);
  }

  async function fetchAll(bucket) {
    setLoadingObjects(true);
    try {
      const data = await apiFetch(`/api/rgw/buckets/${bucket}/objects?fetch_all=true`);
      setObjects(data.objects);
      setObjectInfo({ count: data.total_count, total: data.total_count, truncated: false });
    } catch (_) {}
    setLoadingObjects(false);
  }

  function toggleObj(key) {
    setObjSelected((prev) => {
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
      setObjSelected(new Set(objects.map((o) => o.key)));
    }
  }

  async function handleBulkDelete() {
    if (objSelected.size === 0) return;
    if (!confirm(`Delete ${objSelected.size} object(s)?`)) return;
    setDeletingObjs(true);
    try {
      const resp = await apiFetch(`/api/rgw/buckets/${selected}/objects/bulk-delete`, {
        method: "POST",
        body: JSON.stringify({ keys: Array.from(objSelected) }),
      });
      const kept = objects.filter((o) => !objSelected.has(o.key));
      setObjects(kept);
      setObjSelected(new Set());
      setObjectInfo((prev) => prev ? { ...prev, count: kept.length, total: kept.length } : null);
    } catch (err) {
      alert(err.message);
    }
    setDeletingObjs(false);
  }

  async function handleDelete(bucket, key) {
    if (!confirm(`Delete "${key}"?`)) return;
    try {
      await apiFetch(`/api/rgw/buckets/${bucket}/objects/${encodeURI(key)}`, {
        method: "DELETE",
      });
      setObjects((prev) => prev.filter((o) => o.key !== key));
      setObjSelected((prev) => { const next = new Set(prev); next.delete(key); return next; });
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDownload(bucket, key) {
    try {
      const data = await apiFetch(`/api/rgw/buckets/${bucket}/objects/${encodeURI(key)}/download`);
      window.open(data.url, "_blank");
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) return <div className="be-loading">Loading buckets…</div>;

  return (
    <div className="bucket-explorer">
      <div className="be-sidebar">
        <h3>Buckets</h3>
        {buckets.length === 0 && <p className="be-empty">No buckets</p>}
        {buckets.map((b) => (
          <div
            key={b.name}
            className={`be-bucket ${selected === b.name ? "active" : ""}`}
            onClick={() => openBucket(b.name)}
          >
            <span className="be-bucket-name">{b.name}</span>
          </div>
        ))}
      </div>

      <div className="be-content">
        {!selected && <p className="be-hint">Select a bucket to list objects</p>}

        {selected && (
          <div className="be-meta">
            <strong>{selected}</strong>
            {objectInfo && <> — {objectInfo.count.toLocaleString()} objects</>}
            {objectInfo?.truncated && (
              <>
                {" "}
                <span className="be-truncated">(showing first 100)</span>
                <button className="be-load-all-btn" onClick={() => fetchAll(selected)} disabled={loadingObjects}>
                  {loadingObjects ? "Loading…" : "Load All Objects"}
                </button>
              </>
            )}
            <div className="be-meta-spacer" />
            {objSelected.size > 0 && (
              <button className="be-bulk-del-btn" onClick={handleBulkDelete} disabled={deletingObjs}>
                {deletingObjs ? "Deleting…" : `Delete ${objSelected.size}`}
              </button>
            )}
          </div>
        )}

        {loadingObjects && <div className="be-loading">Fetching objects…</div>}

        {!loadingObjects && objects.length > 0 && (
          <div className="be-table-wrap">
            <table className="be-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" onChange={toggleAllObjs} checked={objSelected.size === objects.length && objects.length > 0} />
                  </th>
                  <th>Key</th>
                  <th>Size</th>
                  <th>Last Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {objects.map((obj) => (
                  <tr key={obj.key} className={objSelected.has(obj.key) ? "be-row-selected" : ""}>
                    <td>
                      <input type="checkbox" checked={objSelected.has(obj.key)} onChange={() => toggleObj(obj.key)} />
                    </td>
                    <td className="be-key">{obj.key}</td>
                    <td>{formatBytes(obj.size)}</td>
                    <td>{obj.last_modified?.slice(0, 19)?.replace("T", " ")}</td>
                    <td className="be-actions">
                      <button className="be-act-btn be-dl" title="Download" onClick={() => handleDownload(selected, obj.key)}>⬇</button>
                      <button className="be-act-btn be-del" title="Delete" onClick={() => handleDelete(selected, obj.key)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default BucketExplorer;

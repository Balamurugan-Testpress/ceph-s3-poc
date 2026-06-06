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

  async function handleDelete(bucket, key) {
    if (!confirm(`Delete "${key}"?`)) return;
    try {
      await apiFetch(`/api/rgw/buckets/${bucket}/objects/${encodeURI(key)}`, {
        method: "DELETE",
      });
      setObjects((prev) => prev.filter((o) => o.key !== key));
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDownload(bucket, key) {
    try {
      const data = await apiFetch(
        `/api/rgw/buckets/${bucket}/objects/${encodeURI(key)}/download`
      );
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
                <button
                  className="be-load-all-btn"
                  onClick={() => fetchAll(selected)}
                  disabled={loadingObjects}
                >
                  {loadingObjects ? "Loading…" : "Load All Objects"}
                </button>
              </>
            )}
          </div>
        )}

        {loadingObjects && <div className="be-loading">Fetching objects…</div>}

        {!loadingObjects && objects.length > 0 && (
          <div className="be-table-wrap">
            <table className="be-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Size</th>
                  <th>Last Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {objects.map((obj) => (
                  <tr key={obj.key}>
                    <td className="be-key">{obj.key}</td>
                    <td>{formatBytes(obj.size)}</td>
                    <td>{obj.last_modified?.slice(0, 19)?.replace("T", " ")}</td>
                    <td className="be-actions">
                      <button
                        className="be-act-btn be-dl"
                        title="Download"
                        onClick={() => handleDownload(selected, obj.key)}
                      >
                        ⬇
                      </button>
                      <button
                        className="be-act-btn be-del"
                        title="Delete"
                        onClick={() => handleDelete(selected, obj.key)}
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
      </div>
    </div>
  );
}

export default BucketExplorer;

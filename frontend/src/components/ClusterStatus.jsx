import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import "./ClusterStatus.css";

function ClusterStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const data = await apiFetch("/api/ceph/status");
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) return <div className="cluster-status-loading">Loading cluster status…</div>;
  if (error) return <div className="cluster-status-error">Error: {error}</div>;
  if (!status?.connected) return <div className="cluster-status-error">Disconnected: {status?.error}</div>;

  const d = status.data;
  const health = d.health || {};
  const df = d.df || {};
  const osdMap = d.osd_map || {};
  const osds = osdMap.osds || [];
  const clientPerf = d.client_perf || {};

  const healthClass =
    health.status === "HEALTH_OK" ? "health-ok" :
    health.status === "HEALTH_WARN" ? "health-warn" : "health-err";

  const upOsds = osds.filter((o) => o.up).length;
  const inOsds = osds.filter((o) => o["in"]).length;

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
  }

  return (
    <div className="cluster-status">
      <div className="cluster-status-grid">
        <div className={`status-card health-card ${healthClass}`}>
          <span className="status-label">Health</span>
          <span className="status-value">{health.status || "N/A"}</span>
        </div>

        <div className="status-card">
          <span className="status-label">OSDs</span>
          <span className="status-value">{upOsds}/{osds.length} up</span>
          <span className="status-sub">{inOsds} in</span>
        </div>

        <div className="status-card">
          <span className="status-label">RGW</span>
          <span className="status-value">{d.rgw ?? "?"}</span>
        </div>

        <div className="status-card">
          <span className="status-label">Hosts</span>
          <span className="status-value">{d.hosts ?? "?"}</span>
        </div>
      </div>

      <div className="cluster-status-grid cluster-status-grid-2">
        <div className="status-card wide">
          <span className="status-label">Storage</span>
          <div className="storage-details">
            <span>Total: {formatBytes(df.stats?.total_bytes)}</span>
            <span>Used: {formatBytes(df.stats?.total_used_raw_bytes)}</span>
            <span>Avail: {formatBytes(df.stats?.total_avail_bytes)}</span>
          </div>
        </div>

        <div className="status-card wide">
          <span className="status-label">Client I/O</span>
          <div className="io-details">
            <span>Read: {formatBytes(clientPerf.read_bytes_sec)}/s</span>
            <span>Write: {formatBytes(clientPerf.write_bytes_sec)}/s</span>
            <span>Ops: {clientPerf.read_op_per_sec ?? 0}r / {clientPerf.write_op_per_sec ?? 0}w</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClusterStatus;

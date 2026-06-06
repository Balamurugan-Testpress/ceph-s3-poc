import { useAuth } from "../context/AuthContext";
import "./QuotaUsage.css";

function formatBytes(bytes) {
  if (bytes === 0 || bytes === null || bytes === undefined) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  // Show 2 decimals for KB/MB/GB/TB, 0 decimals for bytes
  const decimals = i === 0 ? 0 : 2;
  return val.toFixed(decimals) + " " + units[i];
}

function QuotaUsage() {
  const { user } = useAuth();

  const quota = user?.quota_bytes || 1;
  const used = user?.used_bytes || 0;
  const pct = Math.min(100, (used / quota) * 100);
  const barClass = pct > 90 ? "qo-bar danger" : pct > 70 ? "qo-bar warn" : "qo-bar";

  return (
    <div className="quota-usage">
      <h3>Storage Quota</h3>
      <div className={barClass}>
        <div className="qo-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="qo-labels">
        <span className="qo-used">{formatBytes(used)} <small>used</small></span>
        <span className="qo-total">{formatBytes(quota)} <small>total</small></span>
      </div>
    </div>
  );
}

export default QuotaUsage;

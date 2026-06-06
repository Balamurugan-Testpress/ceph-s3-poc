import { useAuth } from "../context/AuthContext";
import "./QuotaUsage.css";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function QuotaUsage() {
  const { user } = useAuth();

  const quota = user?.quota_bytes || 1;
  const used = user?.used_bytes || 0;
  const pct = Math.min(100, ((used / quota) * 100));
  const barClass = pct > 90 ? "qo-bar danger" : pct > 70 ? "qo-bar warn" : "qo-bar";

  return (
    <div className="quota-usage">
      <h3>Storage Quota</h3>
      <div className={barClass}>
        <div className="qo-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="qo-labels">
        <span>{formatBytes(used)} used</span>
        <span>{formatBytes(quota)} total</span>
      </div>
    </div>
  );
}

export default QuotaUsage;

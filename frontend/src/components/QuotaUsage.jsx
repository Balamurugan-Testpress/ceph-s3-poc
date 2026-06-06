import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import "./QuotaUsage.css";

function formatBytes(bytes) {
  if (bytes === 0 || bytes === null || bytes === undefined) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  const decimals = i === 0 ? 0 : 2;
  return val.toFixed(decimals) + " " + units[i];
}

function QuotaUsage() {
  const { user } = useAuth();
  const [used, setUsed] = useState(user?.used_bytes || 0);
  const [quota, setQuota] = useState(user?.quota_bytes || 1);
  const [recalc, setRecalc] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch("/api/s3/usage");
      setUsed(data.used_bytes || 0);
      if (data.quota_bytes !== undefined) setQuota(data.quota_bytes);
    } catch (_) {}
  }, []);

  // Refresh after uploads/deletes (poll every 3s during active use)
  useEffect(() => {
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const pct = Math.min(100, (used / quota) * 100);
  const barClass = pct > 90 ? "qo-bar danger" : pct > 70 ? "qo-bar warn" : "qo-bar";

  async function handleRecalc() {
    setRecalc(true);
    setRecalcMsg(null);
    try {
      const data = await apiFetch("/api/s3/recalculate-usage", { method: "POST" });
      setUsed(data.used_bytes);
      if (data.quota_bytes !== undefined) setQuota(data.quota_bytes);
      setRecalcMsg(`Recalculated: ${formatBytes(data.used_bytes)} used`);
    } catch (err) {
      setRecalcMsg(`Error: ${err.message}`);
    }
    setRecalc(false);
  }

  return (
    <div className="quota-usage">
      <div className="qo-header">
        <h3>Storage Quota</h3>
        <button className="qo-recalc-btn" onClick={handleRecalc} disabled={recalc}>
          {recalc ? "Scanning…" : "Recalculate"}
        </button>
      </div>
      <div className={barClass}>
        <div className="qo-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="qo-labels">
        <span className="qo-used">{formatBytes(used)} <small>used</small></span>
        <span className="qo-total">{formatBytes(quota)} <small>total</small></span>
      </div>
      {recalcMsg && (
        <div className={`qo-msg ${recalcMsg.startsWith("Error") ? "err" : "ok"}`}>
          {recalcMsg}
        </div>
      )}
    </div>
  );
}

export default QuotaUsage;

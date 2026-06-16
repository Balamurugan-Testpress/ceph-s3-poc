import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatBytes } from "../utils/format";

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

  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const isUnlimited = quota <= 0;
  const pct = isUnlimited ? 0 : Math.min(100, (used / quota) * 100);
  const barColor = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-400" : "bg-blue-500";

  return (
    <div className="max-w-md">
      <div className="flex justify-between items-center mb-2">
        <h3 className="m-0 text-sm text-gray-500 font-medium">Storage Quota</h3>
      </div>

      <div className="h-5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between text-sm text-gray-500 mt-1">
        <span>{formatBytes(used)} <small className="text-gray-400">used</small></span>
        {!isUnlimited ? (
          <span>{formatBytes(quota)} <small className="text-gray-400">total</small></span>
        ) : (
          <span className="text-gray-400 italic">No limit</span>
        )}
      </div>

      {recalcMsg && (
        <div className={`mt-1 text-xs px-1.5 py-1 rounded ${
          recalcMsg.startsWith("Error") ? "text-red-700 bg-red-100" : "text-green-800 bg-green-100"
        }`}>
          {recalcMsg}
        </div>
      )}
    </div>
  );
}

export default QuotaUsage;

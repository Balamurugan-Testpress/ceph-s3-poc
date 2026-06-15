import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { RefreshCw } from "lucide-react";

const ACTION_STYLES = {
  create_user:    "text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200",
  create_bucket:  "text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200",
  delete_user:    "text-red-700 bg-red-50 ring-1 ring-red-200",
  delete_bucket:  "text-red-700 bg-red-50 ring-1 ring-red-200",
  delete_object:  "text-red-700 bg-red-50 ring-1 ring-red-200",
  upload_object:  "text-blue-700 bg-blue-50 ring-1 ring-blue-200",
  download_object:"text-violet-700 bg-violet-50 ring-1 ring-violet-200",
};

function ActionBadge({ action }) {
  const key = action?.toLowerCase();
  const style = ACTION_STYLES[key] ?? "text-gray-600 bg-gray-100 ring-1 ring-gray-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${style}`}>
      {action}
    </span>
  );
}

function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, []);

  async function fetchLogs() {
    setRefreshing(true);
    setLoading((prev) => (logs.length === 0 ? true : prev));
    try {
      const data = await apiFetch("/api/admin/audit-logs");
      setLogs(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-400 gap-2">
        <svg className="animate-spin w-4 h-4 text-brand-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        Loading audit logs…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        <span className="mt-0.5">⚠</span>
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex justify-end">
        <button
          onClick={fetchLogs}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Timestamp
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Action
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-4 py-12 text-center text-sm text-gray-400 italic">
                  No audit logs found.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap tabular-nums text-xs">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">
                    {log.username}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <ActionBadge action={log.action} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400 break-all max-w-xs">
                    {log.details || <span className="not-italic text-gray-300">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AuditLogs;

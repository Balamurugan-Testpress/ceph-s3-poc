import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";

function RGWUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(null); // uid being imported
  const [importResult, setImportResult] = useState(null);

  const fetchRGWUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/admin/rgw-users");
      console.log("[RGWUsers] response:", data);
      setUsers(data);
    } catch (err) {
      console.error("[RGWUsers] error:", err);
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRGWUsers();
  }, [fetchRGWUsers]);

  async function handleImport(uid) {
    if (!confirm(`Import RGW user "${uid}" into the app database?`)) return;
    setImporting(uid);
    setImportResult(null);
    try {
      const data = await apiFetch(`/api/admin/rgw-users/${encodeURIComponent(uid)}/import`, {
        method: "POST",
      });
      setImportResult({ success: true, data });
      // Refresh the list
      fetchRGWUsers();
    } catch (err) {
      setImportResult({ success: false, error: err.message });
    }
    setImporting(null);
  }

  const dbUsernames = new Set(
    // We'll populate this from the activity log or just show all
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          RGW users already present in Ceph. Import them into the app database so they can log into the dashboard.
        </p>
        <button
          onClick={fetchRGWUsers}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-60 transition-colors"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Import result toast */}
      {importResult && (
        <div className={`p-3 rounded text-sm border ${
          importResult.success
            ? "bg-green-50 border-green-300 text-green-800"
            : "bg-red-50 border-red-300 text-red-700"
        }`}>
          {importResult.success ? (
            <div>
              <strong>✓ Imported "{importResult.data.username}"</strong>
              <pre className="mt-1 text-xs bg-white p-2 rounded whitespace-pre-wrap">
Username:      {importResult.data.username}{"\n"}
Password:      {importResult.data.temp_password}{"\n"}
Access Key:    {importResult.data.rgw_access_key}{"\n"}
Secret Key:    {importResult.data.rgw_secret_key}
              </pre>
              <p className="text-xs mt-1 text-gray-500">Save these credentials — the password won't be shown again.</p>
            </div>
          ) : (
            <span>Import failed: {importResult.error}</span>
          )}
          <button
            onClick={() => setImportResult(null)}
            className="ml-2 text-xs underline float-right"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading / error */}
      {loading && <div className="text-gray-400 italic text-sm py-4">Loading RGW users from Ceph…</div>}
      {error && !loading && <div className="text-red-600 text-sm py-2">Error: {error}</div>}

      {/* User list */}
      {!loading && !error && users.length === 0 && (
        <div className="text-gray-400 italic text-sm py-4">No RGW users found in Ceph.</div>
      )}

      {users.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-gray-500 font-medium border-b border-gray-200 sticky top-0 bg-gray-50">
                <th className="p-2.5">UID</th>
                <th className="p-2.5">Display Name</th>
                <th className="p-2.5">Buckets</th>
                <th className="p-2.5">Keys</th>
                <th className="p-2.5">Status</th>
                <th className="p-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-2.5 font-mono text-xs">{u.uid}</td>
                  <td className="p-2.5">{u.display_name || "—"}</td>
                  <td className="p-2.5">
                    <span className="inline-flex items-center gap-1">
                      <span className="font-semibold">{u.bucket_count}</span>
                      <span className="text-xs text-gray-400">/ {u.max_buckets || "∞"}</span>
                    </span>
                  </td>
                  <td className="p-2.5">
                    {u.access_key ? (
                      <span className="text-green-600 text-xs font-mono" title={`Access: ${u.access_key}`}>
                        ✓ has keys
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">no keys</span>
                    )}
                  </td>
                  <td className="p-2.5">
                    {u.suspended ? (
                      <span className="text-red-600 text-xs font-medium">Suspended</span>
                    ) : (
                      <span className="text-green-600 text-xs font-medium">Active</span>
                    )}
                  </td>
                  <td className="p-2.5">
                    <button
                      onClick={() => handleImport(u.uid)}
                      disabled={importing === u.uid}
                      className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                    >
                      {importing === u.uid ? "Importing…" : "Import as User"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RGWUsers;

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { X, UserPlus } from "lucide-react";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const initialForm = {
    username: "", password: "", display_name: "",
    user_quota_enabled: false, user_quota_max_size_kb: -1, user_quota_max_objects: -1,
    bucket_quota_enabled: false, bucket_quota_max_size_kb: -1, bucket_quota_max_objects: -1,
    rate_limit_enabled: false, rate_limit_max_read_ops: 0, rate_limit_max_write_ops: 0, rate_limit_max_read_bytes: 0, rate_limit_max_write_bytes: 0
  };
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [editQuota, setEditQuota] = useState(null);
  const [resyncing, setResyncing] = useState(null); // user ID being resynced

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiFetch("/api/admin/users");
      setUsers(data);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
    const interval = setInterval(loadUsers, 60000);
    return () => clearInterval(interval);
  }, [loadUsers]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setResult(null);
    try {
      const resp = await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setResult({ success: true, data: resp });
      setShowForm(false);
      setForm(initialForm);
      loadUsers();
    } catch (err) {
      setResult({ success: false, error: err.message });
    }
    setCreating(false);
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === users.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(users.map((u) => u.id)));
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} user(s)? This will also remove their RGW users and all buckets.`)) return;
    setDeleting(true);
    try {
      const resp = await apiFetch("/api/admin/users/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ user_ids: Array.from(selected) }),
      });
      const failed = resp.results.filter((r) => r.status !== "deleted");
      if (failed.length > 0) {
        alert(`${failed.length} deletion(s) failed:\n${failed.map((f) => `${f.id}: ${f.detail || f.status}`).join("\n")}`);
      }
      setSelected(new Set());
      loadUsers();
    } catch (err) {
      alert(err.message);
    }
    setDeleting(false);
  }

  async function handleDelete(userId) {
    if (!confirm("Delete this user?")) return;
    try {
      await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleResync(userId) {
    if (!confirm("Re-create this user in Ceph RGW? Their existing S3 keys will be replaced with new ones.")) return;
    setResyncing(userId);
    try {
      const resp = await apiFetch(`/api/admin/users/${userId}/resync-rgw`, { method: "POST" });
      alert(`RGW user recreated.\n\nNew Access Key: ${resp.rgw_access_key}\nNew Secret Key: ${resp.rgw_secret_key}\n\nSave these credentials!`);
      loadUsers();
    } catch (err) {
      alert(`Resync failed: ${err.message}`);
    }
    setResyncing(null);
  }

  function startEditQuota(user) {
    setEditQuota({ id: user.id, username: user.username, value: Math.round(user.quota_bytes / 1_048_576) });
  }

  async function saveQuota() {
    if (!editQuota || editQuota.value < 1) return;
    try {
      await apiFetch(`/api/admin/users/${editQuota.id}/quota`, {
        method: "PATCH",
        body: JSON.stringify({ quota_mb: editQuota.value }),
      });
      setEditQuota(null);
      loadUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="mt-2">
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="m-0 text-sm text-gray-500 font-medium">Users</h3>
        <div className="flex gap-2 items-center">
          {selected.size > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {deleting ? "Deleting…" : `Delete ${selected.size}`}
            </button>
          )}
          <button
            onClick={() => { setShowForm(true); setResult(null); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-500 text-white rounded-md hover:bg-brand-600 transition-colors font-medium"
          >
            <UserPlus className="w-4 h-4" />
            New User
          </button>
        </div>
      </div>

      {/* Create User Modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setResult(null); } }}
        >
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 bg-brand-500/10 rounded-lg">
                  <UserPlus className="w-5 h-5 text-brand-500" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900 m-0">Create New User</h2>
                  <p className="text-xs text-gray-400 m-0">Fill in the details to provision a new account</p>
                </div>
              </div>
              <button
                onClick={() => { setShowForm(false); setResult(null); }}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body — scrollable */}
            <div className="overflow-y-auto flex-1 px-6 py-5">
              <form id="create-user-form" onSubmit={handleCreate} className="space-y-5">

                {/* Error banner inside form */}
                {result && !result.success && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <span className="mt-0.5">⚠</span>
                    <span>{result.error}</span>
                  </div>
                )}

                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide">Username <span className="text-red-500">*</span></label>
                    <input
                      value={form.username}
                      onChange={e => setForm({...form, username: e.target.value})}
                      required
                      placeholder="e.g. john.doe"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors placeholder:text-gray-300"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide">Password <span className="text-red-500">*</span></label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={e => setForm({...form, password: e.target.value})}
                      required
                      placeholder="Min 8 characters"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors placeholder:text-gray-300"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide">Display Name</label>
                    <input
                      value={form.display_name}
                      onChange={e => setForm({...form, display_name: e.target.value})}
                      placeholder="Full name (optional)"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors placeholder:text-gray-300"
                    />
                  </div>
                </div>

                {/* User Quota */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <label className="flex items-center gap-3 px-4 py-3 bg-gray-50 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.user_quota_enabled}
                      onChange={e => setForm({...form, user_quota_enabled: e.target.checked})}
                      className="w-4 h-4 accent-brand-500 rounded cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-700">Enable User Quota</span>
                  </label>
                  {form.user_quota_enabled && (
                    <div className="grid grid-cols-2 gap-4 px-4 py-4 border-t border-gray-100">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-500">Max Size (KB)<span className="text-gray-400 font-normal"> · -1 = unlimited</span></label>
                        <input type="number" value={form.user_quota_max_size_kb} onChange={e => setForm({...form, user_quota_max_size_kb: parseInt(e.target.value) || -1})} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-500">Max Objects<span className="text-gray-400 font-normal"> · -1 = unlimited</span></label>
                        <input type="number" value={form.user_quota_max_objects} onChange={e => setForm({...form, user_quota_max_objects: parseInt(e.target.value) || -1})} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Bucket Quota */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <label className="flex items-center gap-3 px-4 py-3 bg-gray-50 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.bucket_quota_enabled}
                      onChange={e => setForm({...form, bucket_quota_enabled: e.target.checked})}
                      className="w-4 h-4 accent-brand-500 rounded cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-700">Enable Bucket Quota</span>
                  </label>
                  {form.bucket_quota_enabled && (
                    <div className="grid grid-cols-2 gap-4 px-4 py-4 border-t border-gray-100">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-500">Max Size (KB)<span className="text-gray-400 font-normal"> · -1 = unlimited</span></label>
                        <input type="number" value={form.bucket_quota_max_size_kb} onChange={e => setForm({...form, bucket_quota_max_size_kb: parseInt(e.target.value) || -1})} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-500">Max Objects<span className="text-gray-400 font-normal"> · -1 = unlimited</span></label>
                        <input type="number" value={form.bucket_quota_max_objects} onChange={e => setForm({...form, bucket_quota_max_objects: parseInt(e.target.value) || -1})} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Rate Limit */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <label className="flex items-center gap-3 px-4 py-3 bg-gray-50 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.rate_limit_enabled}
                      onChange={e => setForm({...form, rate_limit_enabled: e.target.checked})}
                      className="w-4 h-4 accent-brand-500 rounded cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-700">Enable User Rate Limit</span>
                  </label>
                  {form.rate_limit_enabled && (
                    <div className="grid grid-cols-2 gap-4 px-4 py-4 border-t border-gray-100">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-500">Max Read Ops<span className="text-gray-400 font-normal"> · 0 = unlimited</span></label>
                        <input type="number" value={form.rate_limit_max_read_ops} onChange={e => setForm({...form, rate_limit_max_read_ops: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-500">Max Write Ops<span className="text-gray-400 font-normal"> · 0 = unlimited</span></label>
                        <input type="number" value={form.rate_limit_max_write_ops} onChange={e => setForm({...form, rate_limit_max_write_ops: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-500">Max Read Bytes<span className="text-gray-400 font-normal"> · 0 = unlimited</span></label>
                        <input type="number" value={form.rate_limit_max_read_bytes} onChange={e => setForm({...form, rate_limit_max_read_bytes: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-500">Max Write Bytes<span className="text-gray-400 font-normal"> · 0 = unlimited</span></label>
                        <input type="number" value={form.rate_limit_max_write_bytes} onChange={e => setForm({...form, rate_limit_max_write_bytes: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors" />
                      </div>
                    </div>
                  )}
                </div>

              </form>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button
                type="button"
                onClick={() => { setShowForm(false); setResult(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="create-user-form"
                disabled={creating}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                    Creating…
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    Create User
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Error (shown outside modal only when modal is closed) */}
      {result && !result.success && !showForm && (
        <div className="flex items-start gap-2 p-3 mb-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <span className="mt-0.5">⚠</span>
          <span>{result.error}</span>
        </div>
      )}

      {/* Keys reveal */}
      {result?.success && result.data?.rgw_access_key && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-400 rounded text-sm">
          <strong>RGW Credentials — save these!</strong>
          <pre className="mt-2 mb-0 font-mono bg-white p-2 rounded whitespace-pre-wrap text-xs">
            Access Key: {result.data.rgw_access_key}{"\n"}
            Secret Key: {result.data.rgw_secret_key}
          </pre>
        </div>
      )}

      {/* Loading / empty */}
      {loading && <div className="text-gray-400 italic py-2 text-sm">Loading users…</div>}
      {!loading && users.length === 0 && <p className="text-gray-400 italic text-sm">No users yet</p>}

      {/* User table */}
      {users.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-gray-600 font-semibold border-b-2 border-gray-300">
                <th className="p-2">
                  <input
                    type="checkbox"
                    onChange={toggleAll}
                    checked={selected.size === users.length && users.length > 0}
                    className="m-0 cursor-pointer"
                  />
                </th>
                <th className="p-2 whitespace-nowrap">Username</th>
                <th className="p-2 whitespace-nowrap">Display Name</th>
                <th className="p-2 whitespace-nowrap">Usage</th>
                <th className="p-2 whitespace-nowrap">Buckets</th>
                <th className="p-2 whitespace-nowrap">RGW Sync</th>
                <th className="p-2 whitespace-nowrap">Created</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const used = u.used_bytes || 0;
                const rawQuota = u.quota_bytes;
                const isUnlimited = rawQuota <= 0;
                const quota = isUnlimited ? 1 : rawQuota; // prevent div by zero for math
                const pct = isUnlimited ? 0 : Math.min(100, (used / quota) * 100);
                const barColor = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-400" : "bg-blue-500";
                return (
                  <tr
                    key={u.id}
                    className={`border-b border-gray-200 hover:bg-gray-50 ${
                      selected.has(u.id) ? "bg-yellow-100 !bg-yellow-100" : ""
                    }`}
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                        className="m-0 cursor-pointer"
                      />
                    </td>
                    <td className="p-2">
                      <span className="font-medium">{u.username}</span>
                    </td>
                    <td className="p-2 text-gray-600">{u.display_name}</td>
                    <td className="p-2 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          {!isUnlimited && (
                            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${barColor} rounded-full transition-all`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                          <div className={`flex justify-between items-center w-full text-xs text-gray-400 ${isUnlimited ? '' : 'mt-0.5'}`}>
                            <span className="inline-flex items-center gap-1">
                              <span className="font-medium text-gray-700">{formatBytes(used)}</span>
                              {isUnlimited && <span> used</span>}
                            </span>
                            <span>
                              {editQuota && editQuota.id === u.id ? (
                                <span className="inline-flex items-center gap-0.5">
                                  <input
                                    type="number"
                                    min="0"
                                    value={editQuota.value}
                                    onChange={(e) => setEditQuota({ ...editQuota, value: parseInt(e.target.value) || 0 })}
                                    autoFocus
                                    className="w-14 px-1 py-0.5 border border-blue-500 rounded text-xs text-right"
                                  />
                                  <span className="text-gray-400">MB (0=unlimited)</span>
                                  <button onClick={saveQuota} className="px-1 py-0.5 bg-green-600 text-white rounded text-xs cursor-pointer hover:bg-green-700 leading-none">✓</button>
                                  <button onClick={() => setEditQuota(null)} className="px-1 py-0.5 bg-red-600 text-white rounded text-xs cursor-pointer hover:bg-red-700 leading-none">✕</button>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  {isUnlimited ? (
                                    <span className="italic text-gray-400">No limit</span>
                                  ) : (
                                    formatBytes(quota)
                                  )}
                                  <button
                                    onClick={() => startEditQuota(u)}
                                    title="Edit quota"
                                    className="p-0 border-0 bg-transparent cursor-pointer text-gray-300 hover:text-blue-600 text-xs"
                                  >
                                    ✎
                                  </button>
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2">
                      <span className="text-xs text-gray-600">{u.bucket_count ?? "?"}</span>
                    </td>
                    <td className="p-2">
                      {u.rgw_user_id ? (
                        <span className="text-green-600 text-xs" title={`RGW user: ${u.rgw_user_id}`}>
                          ✓ synced
                        </span>
                      ) : (
                        <span className="text-red-600 text-xs">✗ not synced</span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-gray-500">{u.created_at?.slice(0, 10)}</td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        {u.rgw_user_id && u.id !== "admin" && (
                          <button
                            onClick={() => handleResync(u.id)}
                            disabled={resyncing === u.id}
                            className="px-2 py-1 bg-amber-500 text-white rounded text-xs cursor-pointer hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {resyncing === u.id ? "Resyncing…" : "Resync"}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(u.id)}
                          className="px-2 py-1 bg-red-600 text-white rounded text-xs cursor-pointer hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminUsers;

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import "./AdminUsers.css";

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
  const [form, setForm] = useState({ username: "", password: "", display_name: "", quota_mb: 100 });
  const [result, setResult] = useState(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [editQuota, setEditQuota] = useState(null); // {id, username, value}

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiFetch("/api/admin/users");
      setUsers(data);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
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
      setForm({ username: "", password: "", display_name: "", quota_mb: 100 });
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
    <div className="admin-users">
      <div className="au-header">
        <h3>Users</h3>
        <div className="au-header-actions">
          {selected.size > 0 && (
            <button className="au-bulk-del-btn" onClick={handleBulkDelete} disabled={deleting}>
              {deleting ? "Deleting…" : `Delete ${selected.size}`}
            </button>
          )}
          <button className="au-create-btn" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ New User"}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="au-form" onSubmit={handleCreate}>
          <input
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <input
            placeholder="Display Name"
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
          />
          <div className="au-form-row">
            <label>Quota (MB):</label>
            <input
              type="number"
              min="1"
              value={form.quota_mb}
              onChange={(e) => setForm({ ...form, quota_mb: parseInt(e.target.value) || 1 })}
            />
          </div>
          <button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create User"}
          </button>
        </form>
      )}

      {result && !result.success && <div className="au-error">{result.error}</div>}
      {result?.success && result.data?.rgw_access_key && (
        <div className="au-keys-reveal">
          <strong>RGW Credentials — save these!</strong>
          <pre>
            Access Key: {result.data.rgw_access_key}
            Secret Key: {result.data.rgw_secret_key}
          </pre>
        </div>
      )}

      {loading && <div className="au-loading">Loading users…</div>}
      {!loading && users.length === 0 && <p className="au-empty">No users yet</p>}

      {users.length > 0 && (
        <table className="au-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" onChange={toggleAll} checked={selected.size === users.length && users.length > 0} />
              </th>
              <th>Username</th>
              <th>Display Name</th>
              <th>Quota</th>
              <th>Used</th>
              <th>RGW Sync</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={selected.has(u.id) ? "au-row-selected" : ""}>
                <td>
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} />
                </td>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>
                  {editQuota && editQuota.id === u.id ? (
                    <span className="au-quota-edit">
                      <input
                        type="number"
                        min="1"
                        value={editQuota.value}
                        onChange={(e) => setEditQuota({ ...editQuota, value: parseInt(e.target.value) || 1 })}
                        autoFocus
                      />
                      <span className="au-qe-unit"> MB</span>
                      <button className="au-qe-save" onClick={saveQuota}>✓</button>
                      <button className="au-qe-cancel" onClick={() => setEditQuota(null)}>✕</button>
                    </span>
                  ) : (
                    <span className="au-quota-display">
                      {formatBytes(u.quota_bytes)}
                      <button className="au-qe-btn" onClick={() => startEditQuota(u)} title="Edit quota">✎</button>
                    </span>
                  )}
                </td>
                <td>{formatBytes(u.used_bytes)}</td>
                <td>
                  {u.rgw_user_id ? (
                    <span className="au-synced" title={`RGW user: ${u.rgw_user_id}`}>✓ synced</span>
                  ) : (
                    <span className="au-unsynced">✗ not synced</span>
                  )}
                </td>
                <td>{u.created_at?.slice(0, 10)}</td>
                <td>
                  <button className="au-delete-btn" onClick={() => handleDelete(u.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default AdminUsers;

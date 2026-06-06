import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import "./AdminUsers.css";

function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", display_name: "", quota_gb: 1 });
  const [result, setResult] = useState(null);
  const [creating, setCreating] = useState(false);

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
      setForm({ username: "", password: "", display_name: "", quota_gb: 1 });
      loadUsers();
    } catch (err) {
      setResult({ success: false, error: err.message });
    }
    setCreating(false);
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

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
  }

  return (
    <div className="admin-users">
      <div className="au-header">
        <h3>Users</h3>
        <button className="au-create-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ New User"}
        </button>
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
            <label>Quota (GB):</label>
            <input
              type="number"
              min="1"
              value={form.quota_gb}
              onChange={(e) => setForm({ ...form, quota_gb: parseInt(e.target.value) || 1 })}
            />
          </div>
          <button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create User"}
          </button>
        </form>
      )}

      {result && !result.success && (
        <div className="au-error">{result.error}</div>
      )}
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
              <th>Username</th>
              <th>Display Name</th>
              <th>Role</th>
              <th>Quota</th>
              <th>Used</th>
              <th>RGW</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>{u.role}</td>
                <td>{formatBytes(u.quota_bytes)}</td>
                <td>{formatBytes(u.used_bytes)}</td>
                <td>{u.rgw_user_id ? "✓" : "—"}</td>
                <td>{u.created_at?.slice(0, 10)}</td>
                <td>
                  {u.role !== "admin" && (
                    <button className="au-delete-btn" onClick={() => handleDelete(u.id)}>
                      Delete
                    </button>
                  )}
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

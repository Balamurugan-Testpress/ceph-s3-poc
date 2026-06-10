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
        <div className="au-modal-overlay">
          <div className="au-modal">
            <h3>Create New User</h3>
            <form className="au-modal-form" onSubmit={handleCreate}>
              <div className="au-form-grid">
                <div className="au-field">
                  <label>Username</label>
                  <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} required />
                </div>
                <div className="au-field">
                  <label>Password</label>
                  <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required />
                </div>
                <div className="au-field" style={{ gridColumn: "1 / -1" }}>
                  <label>Display Name</label>
                  <input value={form.display_name} onChange={e => setForm({...form, display_name: e.target.value})} />
                </div>
              </div>

              <fieldset className="au-fieldset">
                <legend>
                  <label className="au-field-checkbox">
                    <input type="checkbox" checked={form.user_quota_enabled} onChange={e => setForm({...form, user_quota_enabled: e.target.checked})} />
                    Enable User Quota
                  </label>
                </legend>
                {form.user_quota_enabled && (
                  <div className="au-form-grid">
                    <div className="au-field">
                      <label>Max Size (KB) [-1 for unlimited]</label>
                      <input type="number" value={form.user_quota_max_size_kb} onChange={e => setForm({...form, user_quota_max_size_kb: parseInt(e.target.value) || -1})} />
                    </div>
                    <div className="au-field">
                      <label>Max Objects [-1 for unlimited]</label>
                      <input type="number" value={form.user_quota_max_objects} onChange={e => setForm({...form, user_quota_max_objects: parseInt(e.target.value) || -1})} />
                    </div>
                  </div>
                )}
              </fieldset>

              <fieldset className="au-fieldset">
                <legend>
                  <label className="au-field-checkbox">
                    <input type="checkbox" checked={form.bucket_quota_enabled} onChange={e => setForm({...form, bucket_quota_enabled: e.target.checked})} />
                    Enable Bucket Quota
                  </label>
                </legend>
                {form.bucket_quota_enabled && (
                  <div className="au-form-grid">
                    <div className="au-field">
                      <label>Max Size (KB) [-1 for unlimited]</label>
                      <input type="number" value={form.bucket_quota_max_size_kb} onChange={e => setForm({...form, bucket_quota_max_size_kb: parseInt(e.target.value) || -1})} />
                    </div>
                    <div className="au-field">
                      <label>Max Objects [-1 for unlimited]</label>
                      <input type="number" value={form.bucket_quota_max_objects} onChange={e => setForm({...form, bucket_quota_max_objects: parseInt(e.target.value) || -1})} />
                    </div>
                  </div>
                )}
              </fieldset>

              <fieldset className="au-fieldset">
                <legend>
                  <label className="au-field-checkbox">
                    <input type="checkbox" checked={form.rate_limit_enabled} onChange={e => setForm({...form, rate_limit_enabled: e.target.checked})} />
                    Enable User Rate Limit
                  </label>
                </legend>
                {form.rate_limit_enabled && (
                  <div className="au-form-grid">
                    <div className="au-field">
                      <label>Max Read Ops (0 for unlimited)</label>
                      <input type="number" value={form.rate_limit_max_read_ops} onChange={e => setForm({...form, rate_limit_max_read_ops: parseInt(e.target.value) || 0})} />
                    </div>
                    <div className="au-field">
                      <label>Max Write Ops (0 for unlimited)</label>
                      <input type="number" value={form.rate_limit_max_write_ops} onChange={e => setForm({...form, rate_limit_max_write_ops: parseInt(e.target.value) || 0})} />
                    </div>
                    <div className="au-field">
                      <label>Max Read Bytes (0 for unlimited)</label>
                      <input type="number" value={form.rate_limit_max_read_bytes} onChange={e => setForm({...form, rate_limit_max_read_bytes: parseInt(e.target.value) || 0})} />
                    </div>
                    <div className="au-field">
                      <label>Max Write Bytes (0 for unlimited)</label>
                      <input type="number" value={form.rate_limit_max_write_bytes} onChange={e => setForm({...form, rate_limit_max_write_bytes: parseInt(e.target.value) || 0})} />
                    </div>
                  </div>
                )}
              </fieldset>

              <div className="au-modal-actions">
                <button type="button" className="au-btn-cancel" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="au-btn-submit" disabled={creating}>
                  {creating ? "Creating…" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
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

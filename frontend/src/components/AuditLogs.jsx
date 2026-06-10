import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import "./AuditLogs.css";

function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  async function fetchLogs() {
    setLoading(true);
    try {
      const data = await apiFetch("/api/admin/audit-logs");
      setLogs(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="audit-loading">Loading audit logs...</div>;
  if (error) return <div className="audit-error">Error: {error}</div>;

  return (
    <div className="audit-logs-container">
      <div className="audit-header">
        <button onClick={fetchLogs} className="audit-refresh-btn">Refresh</button>
      </div>
      <table className="audit-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{new Date(log.timestamp).toLocaleString()}</td>
              <td>{log.username}</td>
              <td><span className={`audit-action action-${log.action.toLowerCase()}`}>{log.action}</span></td>
              <td className="audit-details">{log.details ? log.details : "-"}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan="4" className="audit-empty">No audit logs found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default AuditLogs;

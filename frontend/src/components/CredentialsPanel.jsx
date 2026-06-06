import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import "./CredentialsPanel.css";

function CredentialsPanel() {
  const { user } = useAuth();
  const [creds, setCreds] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || user.role === "admin") return;
    setLoading(true);
    apiFetch("/auth/credentials")
      .then((data) => setCreds(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  if (!user || user.role === "admin" || loading) return null;
  if (!creds?.access_key) return null;

  return (
    <div className="creds-panel">
      <h3>S3 Credentials</h3>
      <p className="creds-hint">
        Use these for direct S3 access (AWS CLI, SDK, etc.)
      </p>
      <div className="creds-row">
        <label>Access Key</label>
        <code>{creds.access_key}</code>
      </div>
      <div className="creds-row">
        <label>Secret Key</label>
        <code>{creds.secret_key}</code>
      </div>
      <p className="creds-note">
        Keys are read-only. Contact an admin to rotate them.
      </p>
    </div>
  );
}

export default CredentialsPanel;

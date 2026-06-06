// Uses relative URLs — the Vite dev server proxies /api, /auth, /health to the backend.
const API_BASE = import.meta.env.VITE_API_BASE || "";

function getToken() {
  try {
    const data = localStorage.getItem("ceph_s3_auth");
    if (data) return JSON.parse(data).token;
  } catch {
    /* ignore */
  }
  return null;
}

function clearAuth() {
  localStorage.removeItem("ceph_s3_auth");
  window.location.href = "/login";
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearAuth();
    throw new Error("Session expired. Please login again.");
  }

  if (res.status === 204) {
    return null;
  }

  const body = await res.json();

  if (!res.ok) {
    const msg = body.detail || body.message || `Request failed with status ${res.status}`;
    throw new Error(msg);
  }

  return body;
}

export { apiFetch, getToken };

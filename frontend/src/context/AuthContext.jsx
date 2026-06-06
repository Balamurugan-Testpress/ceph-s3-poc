import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "../api/client";

const STORAGE_KEY = "ceph_s3_auth";

const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.user && parsed.token) {
          setUser(parsed.user);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setLoading(false);
  }, []);

  async function login(username, password) {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    const userData = {
      id: data.user.id,
      username: data.user.username,
      display_name: data.user.display_name || data.user.username,
      role: data.user.role,
      quota_bytes: data.user.quota_bytes,
      used_bytes: data.user.used_bytes,
      has_rgw: !!(data.user.rgw_access_key && data.user.rgw_secret_key),
    };

    const session = { token: data.access_token, user: userData };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setUser(userData);
    return userData;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { AuthProvider, useAuth };

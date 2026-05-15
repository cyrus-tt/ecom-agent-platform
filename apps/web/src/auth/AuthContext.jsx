import { createContext, useContext, useEffect, useState } from "react";
import http from "../api/http";
import { NO_ACCESS_ROUTE, hasModulePermission } from "./modules";

const AuthContext = createContext(null);

function normalizeAuthPayload(data) {
  return {
    accountId: String(data?.account_id || "").trim(),
    username: String(data?.username || "").trim(),
    name: String(data?.name || data?.username || "").trim(),
    isAdmin: data?.is_admin === true,
    permissions: Array.isArray(data?.permissions) ? data.permissions.map((item) => String(item || "").trim()).filter(Boolean) : [],
    sharedUsername: String(data?.shared_username || "").trim(),
    preferredRoute: String(data?.preferred_route || "").trim() || NO_ACCESS_ROUTE,
    expiresAt: String(data?.expires_at || "").trim(),
    defaultChannels: Array.isArray(data?.default_channels) ? data.default_channels : [],
    defaultCategories: Array.isArray(data?.default_categories) ? data.default_categories : [],
  };
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refreshAuth(options = {}) {
    const silent = options.silent === true;
    if (!silent) {
      setLoading(true);
    }
    try {
      const resp = await http.get("/api/auth/me", {
        params: { _t: Date.now() },
      });
      const nextAuth = normalizeAuthPayload(resp.data || {});
      setAuth(nextAuth);
      return nextAuth;
    } catch (err) {
      if (err?.response?.status === 401) {
        setAuth(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        auth,
        loading,
        isAdmin: auth?.isAdmin === true,
        preferredRoute: auth?.preferredRoute || NO_ACCESS_ROUTE,
        hasPermission: (moduleKey) => hasModulePermission(auth, moduleKey),
        hasAnyPermission: (moduleKeys) => (Array.isArray(moduleKeys) ? moduleKeys.some((item) => hasModulePermission(auth, item)) : false),
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

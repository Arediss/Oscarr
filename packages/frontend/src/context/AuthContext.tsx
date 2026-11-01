import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import api from '@/lib/api';
import { advanceAuthSession, getAuthSessionVersion, subscribeSessionExpired } from '@/lib/authSession';
import type { User } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (token: string, user: User) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch /auth/me and update the user/permissions in context. Call after a mutation that
   *  changed user state on the server (e.g. picking an avatar source) so every consumer reads
   *  the same fresh value. */
  refreshUser: () => Promise<void>;
  isAdmin: boolean;
  hasAccess: boolean;
  permissions: string[];
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);

  const clearSession = useCallback(() => {
    setUser(null);
    setPermissions([]);
    setLoading(false);
  }, []);

  const fetchUser = useCallback(async () => {
    const version = getAuthSessionVersion();
    try {
      const { data } = await api.get('/auth/me');
      // A refresh started before logout/expiry must not restore an obsolete user.
      if (version !== getAuthSessionVersion()) return;
      const { permissions: perms = [], ...userData } = data;
      setUser(userData);
      setPermissions(perms);
    } catch (err) {
      if (version !== getAuthSessionVersion()) return;
      // 401/403 = genuine logout. Network error or 5xx = backend hiccup — don't log the user
      // out silently, keep last state and just stop the loading spinner. BackendGate already
      // blocks mount until backend is reachable, so this only fires on mid-session transients.
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 401 || status === 403) {
        advanceAuthSession();
        clearSession();
      } else {
        console.warn('[AuthContext] /auth/me transient failure, keeping session', err);
      }
    } finally {
      if (version === getAuthSessionVersion()) setLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    const unsubscribe = subscribeSessionExpired(clearSession);
    void fetchUser();
    return () => {
      unsubscribe();
      advanceAuthSession();
    };
  }, [fetchUser, clearSession]);

  const login = useCallback(async (_token: string, userData: User) => {
    // Token is now stored exclusively in httpOnly cookie by the backend
    advanceAuthSession();
    setUser(userData);
    setPermissions([]);
    // Fetch full user data including permissions
    await fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    const version = advanceAuthSession();
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    // Wait for the cookie-clearing response before exposing the login form.
    if (version === getAuthSessionVersion()) clearSession();
  }, [clearSession]);

  const hasPermission = useCallback((permission: string): boolean => {
    if (permissions.length === 0) return false;
    // Admin wildcard
    if (permissions.includes('*')) return true;
    // Exact match
    if (permissions.includes(permission)) return true;
    // Wildcard match: 'admin.*' matches 'admin.users', 'admin.roles', etc.
    const parts = permission.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const wildcard = parts.slice(0, i).join('.') + '.*';
      if (permissions.includes(wildcard)) return true;
    }
    return false;
  }, [permissions]);

  const isAdmin = hasPermission('admin.*');
  const hasAccess = isAdmin || (user?.providers ?? []).length > 0;

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser: fetchUser, isAdmin, hasAccess, permissions, hasPermission }),
    [user, loading, login, logout, fetchUser, isAdmin, hasAccess, permissions, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

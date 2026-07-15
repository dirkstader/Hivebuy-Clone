import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { apiRequest, queryClient, setAuthToken, setUnauthorizedHandler } from "./queryClient";
import type { User } from "@shared/schema";

// All demo-seeded users share this password (see server/seed.ts / README).
const DEMO_PASSWORD = "demo1234";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  switchUser: (user: User) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    // All queries are keyed without a user id (there's no per-user cache segmentation), so
    // switching to a different account without a page reload — logout, or the demo-user
    // switcher on the login page — must drop every cached response. Otherwise the next
    // user briefly sees the previous user's data for anything already in the cache.
    queryClient.clear();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/auth/login", { email, password });
      const { user, token } = await res.json();
      setAuthToken(token);
      setUser(user);
      return true;
    } catch (e: any) {
      setError("E-Mail oder Passwort ist falsch.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    apiRequest("POST", "/api/auth/logout").catch(() => {});
    clearSession();
  }, [clearSession]);

  // The one-click demo user switcher on the login page still has to go through a real
  // login — it just reuses the shared demo password instead of asking for it again.
  const switchUser = useCallback((u: User) => login(u.email, DEMO_PASSWORD), [login]);

  return (
    <AuthContext.Provider value={{ user, isLoading, error, login, logout, switchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const ROLE_LABELS: Record<string, string> = {
  requester: "Antragsteller",
  approver: "Genehmiger",
  purchasing: "Admin",
  finance: "Finance/Controlling",
};

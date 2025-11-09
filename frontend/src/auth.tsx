import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api, loadTokensFromStorage, setTokens } from "./api";

export type User = {
  id: number;
  email: string;
  full_name: string;
  role: "student" | "lead" | "admin";
  barcode_id: string | null;
  student_id: string | null;
  is_active: boolean;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<User | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile() {
    try {
      const res = await api.get<User>("/auth/me");
      setUser(res.data);
      return res.data;
    } catch (error) {
      setTokens(null, null);
      setUser(null);
      throw error;
    }
  }

  useEffect(() => {
    const tokens = loadTokensFromStorage();
    if (!tokens.accessToken || !tokens.refreshToken) {
      setLoading(false);
      return;
    }
    fetchProfile().finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const body = new URLSearchParams();
    body.append("username", email);
    body.append("password", password);
    body.append("scope", "");
    const tokenRes = await api.post("/auth/login", body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    setTokens(tokenRes.data.access_token, tokenRes.data.refresh_token);
    await fetchProfile();
  }

  function logout() {
    setTokens(null, null);
    setUser(null);
  }

  async function refreshUser() {
    const tokens = loadTokensFromStorage();
    if (!tokens.accessToken || !tokens.refreshToken) {
      setUser(null);
      return null;
    }
    try {
      return await fetchProfile();
    } catch {
      return null;
    }
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

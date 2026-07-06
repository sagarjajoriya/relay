"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthResponse, AuthUser } from "@relay/contracts";
import { api } from "./api";

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
}

interface AuthContextValue extends AuthState {
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const STORAGE_KEY = "relay.auth";
const AuthContext = createContext<AuthContextValue | null>(null);

function persist(state: AuthState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null, refreshToken: null });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setState(JSON.parse(raw));
    setReady(true);
  }, []);

  function applyAuthResponse(res: AuthResponse) {
    const next: AuthState = { user: res.user, accessToken: res.accessToken, refreshToken: res.refreshToken };
    setState(next);
    persist(next);
  }

  async function login(email: string, password: string) {
    const res = await api.post<AuthResponse>("/auth/login", { email, password });
    applyAuthResponse(res);
  }

  async function register(email: string, password: string, displayName: string) {
    const res = await api.post<AuthResponse>("/auth/register", { email, password, displayName });
    applyAuthResponse(res);
  }

  async function logout() {
    if (state.refreshToken) {
      await api.post("/auth/logout", { refreshToken: state.refreshToken }).catch(() => undefined);
    }
    const next: AuthState = { user: null, accessToken: null, refreshToken: null };
    setState(next);
    persist(next);
  }

  return (
    <AuthContext.Provider value={{ ...state, ready, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

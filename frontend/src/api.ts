import axios, { AxiosRequestHeaders } from "axios";

const ENV_BASE = (import.meta as any).env.VITE_API_URL as string | undefined;
const ENV_API_PORT = (import.meta as any).env.VITE_API_PORT as string | undefined;

function resolveApiBase(): string {
  const defaultBackendPort = ENV_API_PORT || "8000";
  const fallback = `http://localhost:${defaultBackendPort}`;
  let base = ENV_BASE ?? fallback;
  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    const envPointsToLoopback = /(^|\/)localhost(?=[:/]|$)|(^|\/)127\.0\.0\.1(?=[:/]|$)/i.test(base);

    // On localhost, hit the backend port directly
    if (isLocalHost) {
      return `${protocol}//${hostname}:${defaultBackendPort}`;
    }

    // Behind a reverse proxy (Coolify, etc.): use /api path on same origin.
    // Nginx proxies /api/* to the backend, stripping the /api prefix.
    if (envPointsToLoopback || (ENV_BASE ?? "").toLowerCase() === "auto") {
      return `${protocol}//${hostname}${port ? `:${port}` : ""}/api`;
    }
  }
  return base;
}

export const API_BASE = resolveApiBase();

export const api = axios.create({
  baseURL: API_BASE,
});

const rawClient = axios.create({ baseURL: API_BASE });

const STORAGE_KEY = "robotics_tokens";

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

function persist() {
  if (accessToken && refreshToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, refreshToken }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function loadTokensFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { accessToken: null, refreshToken: null };
  try {
    const parsed = JSON.parse(raw);
    accessToken = parsed.accessToken;
    refreshToken = parsed.refreshToken;
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return { accessToken: null, refreshToken: null };
  }
}

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  persist();
}

export function getAccessToken() {
  return accessToken;
}

api.interceptors.request.use((config) => {
  if (!config.headers) config.headers = {} as AxiosRequestHeaders;
  if (accessToken) {
    (config.headers as any).Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

async function refreshAccessToken() {
  if (!refreshToken) throw new Error("No refresh token");
  if (!refreshPromise) {
    refreshPromise = rawClient
      .post("/auth/refresh", { refresh_token: refreshToken })
      .then((res) => {
        accessToken = res.data.access_token;
        refreshToken = res.data.refresh_token;
        persist();
        return accessToken!;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original?._retry && refreshToken) {
      original._retry = true;
      try {
        const newToken = await refreshAccessToken();
        original.headers = (original.headers ?? {}) as AxiosRequestHeaders;
        (original.headers as any).Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        setTokens(null, null);
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

declare module "axios" {
  interface AxiosRequestConfig {
    _retry?: boolean;
  }
}
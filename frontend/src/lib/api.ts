/**
 * Resolve backend base URL across runtimes:
 *  - Vite dev (5173): empty → proxied to :3847
 *  - Production (served by backend on :3847): empty → same origin
 *  - Custom host: set VITE_API_BASE at build time or window.__PINODES_ORCHESTRA_API__
 */
function resolveBase(): string {
  if (typeof window === "undefined") {
    return process.env.VITE_API_BASE ?? "http://localhost:3847";
  }

  const runtime = (window as { __PINODES_ORCHESTRA_API__?: string }).__PINODES_ORCHESTRA_API__;
  if (runtime) return runtime.replace(/\/$/, "");

  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  if (envBase) return envBase.replace(/\/$/, "");

  if (import.meta.env.DEV) return "";

  const { protocol, port } = window.location;
  if (protocol.startsWith("http") && port === "3847") return "";

  return "http://localhost:3847";
}

export const API_BASE = resolveBase();

/** Build an absolute (or proxied-relative) URL for a backend path. */
export function api(path: string): string {
  return `${API_BASE}${path}`;
}

/** WebSocket URL for the backend. */
export function wsUrl(): string {
  if (API_BASE) {
    const base = API_BASE.replace(/^http/, "ws");
    return `${base}/ws`;
  }
  if (import.meta.env.DEV) return "ws://localhost:3847/ws";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

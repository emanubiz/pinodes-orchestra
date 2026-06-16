import { IS_EMBEDDED } from "./embed";

/**
 * Theme bridge for host-embedded mode.
 *
 * When framed inside a host webview (VS Code), the app runs in a *cross-origin*
 * iframe and therefore can't read the host's `--vscode-*` CSS variables. The
 * host webview reads its resolved theme colors and forwards them via
 * `postMessage`; here we apply them to `--app-bg` / `--app-fg` so the canvas,
 * terminals and base surfaces blend with the editor instead of being a fixed
 * near-black. Standalone (no host) keeps the default palette.
 */
interface HostThemeMessage {
  type: "host-theme";
  bg?: string;
  fg?: string;
  kind?: "dark" | "light";
}

export function initEmbedTheme(): void {
  if (!IS_EMBEDDED) return;
  const root = document.documentElement;

  const apply = (msg: HostThemeMessage): void => {
    if (msg.bg) root.style.setProperty("--app-bg", msg.bg);
    if (msg.fg) root.style.setProperty("--app-fg", msg.fg);
    if (msg.kind) root.style.setProperty("color-scheme", msg.kind);
  };

  window.addEventListener("message", (ev: MessageEvent) => {
    const msg = ev.data as HostThemeMessage | undefined;
    if (msg && msg.type === "host-theme") apply(msg);
  });

  // The host posts the theme on iframe load, but our listener may attach after
  // that first post — announce readiness so the host re-sends.
  try {
    window.parent?.postMessage({ type: "orchestra-ready" }, "*");
  } catch {
    /* not framed (standalone) */
  }
}

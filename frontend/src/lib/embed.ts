/**
 * Embedded-host detection.
 *
 * When Orchestra is framed inside a host that already owns the notion of a
 * "current project" (VS Code / Cursor workspace), we drop the multi-board
 * repo-tab switcher and bind the single board to the host-provided cwd.
 *
 * The host passes this via the iframe URL, e.g.
 *   http://localhost:3847/?embed=vscode&cwd=/abs/path/to/workspace
 *
 * Standalone (browser/PWA) sets neither param and keeps the full board UI.
 */
function readParams(): { mode: string | null; cwd: string | null } {
  if (typeof window === "undefined") return { mode: null, cwd: null };
  try {
    const p = new URLSearchParams(window.location.search);
    const mode = p.get("embed");
    const cwd = p.get("cwd");
    return { mode: mode || null, cwd: cwd || null };
  } catch {
    return { mode: null, cwd: null };
  }
}

const params = readParams();

/** True when running embedded in a host (e.g. the VS Code extension). */
export const EMBED_MODE: string | null = params.mode;

/** True when the multi-board repo switcher should be hidden. */
export const IS_EMBEDDED = EMBED_MODE !== null;

/** Host-provided workspace folder to bind the single board to (or null). */
export const EMBED_CWD: string | null = params.cwd;

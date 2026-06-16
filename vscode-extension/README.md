# Pi Orchestra — VS Code extension

Runs the [pi-orchestra](../README.md) visual multi-agent console inside VS Code:
graph canvas, live per-node terminals, and visible `@@HANDOFF` delegation — the
same UI as the standalone web app, embedded in an editor webview.

> Implements **Phase 2** of [`docs/EXTENSIONS_ROADMAP.md`](../docs/EXTENSIONS_ROADMAP.md):
> a thin wrapper that spawns the existing Fastify backend as a Node subprocess
> and frames the built frontend. No `node-pty` / `better-sqlite3` runs in the
> extension host.

## How it works

```
VS Code
├─ Activity Bar ▸ Pi Orchestra (control view: status + Open/Restart/Stop/Logs)
├─ Command "Open Pi Orchestra" ▸ editor webview ▸ <iframe src=localhost:3847>
└─ Extension host ▸ spawns `node backend/dist/index.js` (cwd = workspace folder)
```

- The backend serves the full React Flow + xterm UI on `/` and exposes `/api/health`.
- The webview iframes the backend through `vscode.env.asExternalUri`, so live PTY
  WebSockets run inside the iframe against the backend origin.
- If a backend already answers on the port (e.g. you ran `npm run dev`), the
  extension **adopts** it instead of spawning a second one.

## Requirements

- **Node.js 22+** on your `PATH` (used to run the backend subprocess).
- A **built backend + frontend** in the repo: from the repo root run
  ```bash
  npm install && npm run build
  ```
- `@earendil-works/pi-coding-agent` available to the backend, and pi auth/keys
  (see the repo README) for agent nodes to actually run.

## Develop / run locally

```bash
cd vscode-extension
npm install
npm run compile      # or: npm run watch
```

Then press **F5** (“Run Pi Orchestra Extension”) to launch an Extension
Development Host. Open a folder, click the Pi Orchestra activity-bar icon, then
**Open Pi Orchestra**.

## Package

```bash
npm run package      # produces a .vsix via @vscode/vsce
```

To ship a self-contained `.vsix`, bundle the built `backend/` and
`frontend/dist/` so the default layout `<extension>/../backend/dist/index.js`
resolves — or set `piOrchestra.backendEntry` to wherever you place it.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `piOrchestra.port` | `3847` | Backend port. The bundled frontend resolves its API on the same origin only for `3847`; change only if you rebuild the frontend with a matching `VITE_API_BASE`. |
| `piOrchestra.nodeCommand` | `node` | Node runtime used to launch the backend. |
| `piOrchestra.backendEntry` | _(auto)_ | Absolute path to `backend/dist/index.js`. Empty = resolve relative to the extension. |
| `piOrchestra.autoStartBackend` | `true` | Start the backend when the panel opens if none is running. |

## Known limitations (MVP)

- Single backend port assumption (`3847`) tied to the standalone frontend's
  same-origin API resolution.
- Backend isn't bundled into the `.vsix` yet — it references the repo build.
- Cursor (VS Code fork) uses the same architecture; see the roadmap for the
  `runtime: "cursor"` node plan.

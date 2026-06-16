# pinodes-orchestra

Visual canvas of **pi** agent consoles. Semi-automatic multi-agent pipeline with human intervention on any node.

This is a **web app / PWA**: React frontend + Node.js backend (Fastify + WebSocket + SQLite + PTY).

## Quick start

```bash
cd pinodes-orchestra
npm install
npm run dev
```

Starts:

- backend → `http://localhost:3847`
- Vite dev server → `http://localhost:5173`

Open <http://localhost:5173> in your browser.

## Production / self-hosted

```bash
npm run build
npm run start
```

Backend serves `frontend/dist` on `http://localhost:3847`.

## Install as PWA

In Chrome/Edge, use the browser **Install** action. The service worker caches static assets; agent execution still needs the backend running.

## Run in VS Code

The repo ships a VS Code extension (`vscode-extension/`) that embeds the same
canvas in an editor webview. It spawns the backend as a Node subprocess (no
`node-pty`/SQLite in the extension host) and binds the board to the open
workspace folder — no repo-tab switcher, since VS Code already owns the cwd.

```bash
# build the app the extension serves, then the extension itself
npm run build
cd vscode-extension && npm install && npm run compile
npx @vscode/vsce package        # produces a .vsix
code --install-extension pinodes-orchestra-vscode-*.vsix
```

Reload VS Code → **PiNodes Orchestra** in the Activity Bar → **Open PiNodes Orchestra**.
See [`vscode-extension/README.md`](./vscode-extension/README.md) for details.

## Requirements

- Node.js 22+
- `@earendil-works/pi-coding-agent` globally or in `backend/node_modules`
- API keys in `~/.pi/agent/auth.json` or env vars

## Usage

1. **Left tabs**: one board per repo folder; **+** to open another path
2. Click a prompt in the library → adds a node to the active board
3. Drag connections between nodes (defines hand-off permissions)
4. Select a node → interactive terminal in side panel
5. Agents hand off via `@@HANDOFF` blocks (see [ARCHITECTURE.md](./ARCHITECTURE.md))
6. **Save** / **Load…** for workflows (stored with cwd + entry node)
7. **Kanban** view: launch tasks into entry nodes

## Configuration

| Variable | Purpose |
|----------|---------|
| `PORT` | Port the backend listens on (default 3847) |
| `PINODES_ORCHESTRA_URL` | Base URL pi nodes use to call back (default `http://localhost:<port>`) |
| `PINODES_ORCHESTRA_PORT` | Override only the port in that callback URL (does **not** change the listen port — set `PORT` for that) |
| `PINODES_ORCHESTRA_DATA_DIR` | SQLite location |
| `PINODES_ORCHESTRA_TOKEN` | Shared secret for programmatic API auth (optional) |
| `VITE_API_BASE` | Custom backend URL at frontend build time |

## Documentation

| Doc | Contents |
|-----|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Current system design, WS protocol, handoff |
| [docs/EXTENSIONS_ROADMAP.md](./docs/EXTENSIONS_ROADMAP.md) | Host integrations — VS Code (done), Cursor, Hermes, OpenClaw |
| [vscode-extension/README.md](./vscode-extension/README.md) | VS Code extension — how it works, build, settings |
| [docs/HERMES_DESKTOP.md](./docs/HERMES_DESKTOP.md) | Hermes Desktop analysis |
| [docs/PROGRAMMATIC_API.md](./docs/PROGRAMMATIC_API.md) | REST/CLI API for programmatic orchestration (boards, flows, auth) |

## Programmatic API

Board lifecycle, graph load, and flow execution are available as a REST API at `/api/v1/orchestra/*`. Useful for CI pipelines, host integrations (VSCode, Hermes, OpenClaw), and scripting.

```bash
# Create a board, load a graph, and run a flow
curl -s http://localhost:3847/api/v1/orchestra/flows \
  -H 'Content-Type: application/json' \
  -d '{ "name": "auth", "cwd": "/path/to/repo", "graph": { ... }, "message": "Implement auth", "wait": true }'
```

Details: [docs/PROGRAMMATIC_API.md](./docs/PROGRAMMATIC_API.md).

## Host integrations

Standalone is the reference implementation. Hosts:

- **VS Code** — ✅ webview extension (`vscode-extension/`, see above)
- **Cursor** — same architecture as VS Code (planned: native `runtime: "cursor"` nodes)
- **Hermes Desktop** — Orchestra tab via remote dashboard or embedded webview (planned)
- **OpenClaw** — Orchestra tab via Gateway HTTP route or external WS client (planned)

Details: [docs/EXTENSIONS_ROADMAP.md](./docs/EXTENSIONS_ROADMAP.md).

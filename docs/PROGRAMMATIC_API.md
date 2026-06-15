# Programmatic API (planned)

REST and CLI surface for **host integrations** — Hermes Desktop tab, OpenClaw plugin, VSCode/Cursor extension, CI pipelines.

> **Status:** specified, not fully implemented. Standalone today uses WebSocket for live control and partial REST for persistence. This document is the contract future hosts should target.

## Design goals

1. Hosts can **create and run flows without the UI**
2. Same graph model as the canvas (`WorkflowGraph`)
3. UI and API share one backend — no divergent code paths
4. Idempotent operations where possible (safe for CI retry)

## Base URL

```
http://localhost:3847   # default standalone
```

Configurable via `PI_ORCHESTRA_PORT` / `PI_ORCHESTRA_URL`.

---

## Implemented today (standalone)

### Info & health

```http
GET /api/health
→ { ok, name, version, port }

GET /api/info
→ { ok, name, version, port, defaultCwd, wsPath }
```

### Prompts

```http
GET    /api/prompts
POST   /api/prompts        { name, content }
PUT    /api/prompts/:id    { name, content }
DELETE /api/prompts/:id
```

### Workflows (persistence only)

```http
GET    /api/workflows
GET    /api/workflows/:id
POST   /api/workflows      WorkflowGraph
DELETE /api/workflows/:id
```

Saving a workflow does **not** load it into PtyHub — use orchestration endpoints below.

### Path validation

```http
POST /api/validate-path    { path }
→ { ok, path } | { ok: false, error }
```

### Internal (pi extension callbacks)

```http
POST /internal/call-agent   { boardId, fromNodeId, targetNodeId, message }
POST /internal/card-status  { boardId, column }
```

---

## Planned — Orchestration REST API

Prefix: `/api/v1/orchestra`

### Boards

```http
POST /api/v1/orchestra/boards
Body: { cwd: string, label?: string }
→ { boardId, cwd, label }

GET /api/v1/orchestra/boards
→ { boards: [{ boardId, cwd, label, nodeCount, runningCount }] }

DELETE /api/v1/orchestra/boards/:boardId
→ { ok: true }
```

### Graph (load into live backend)

```http
PUT /api/v1/orchestra/boards/:boardId/graph
Body: WorkflowGraph
→ { ok: true, nodeIds: string[] }

GET /api/v1/orchestra/boards/:boardId/graph
→ WorkflowGraph
```

Equivalent WebSocket command today: `{ type: "load_graph", graph, cwd }`.

### Nodes

```http
POST /api/v1/orchestra/boards/:boardId/nodes
Body: { label, promptId, promptOverride?, position?: {x,y} }
→ { nodeId, ... }

DELETE /api/v1/orchestra/boards/:boardId/nodes/:nodeId
→ { ok: true }

POST /api/v1/orchestra/boards/:boardId/edges
Body: { sourceNodeId, targetNodeId }
→ { edgeId }

DELETE /api/v1/orchestra/boards/:boardId/edges/:edgeId
→ { ok: true }
```

### Execution

```http
POST /api/v1/orchestra/boards/:boardId/run
Body: {
  nodeId: string,          # entry node (or explicit target)
  message: string,         # initial task
  trackKanban?: boolean
}
→ { ok: true, boardId, nodeId }

POST /api/v1/orchestra/boards/:boardId/nodes/:nodeId/inject
Body: { message: string }
→ { ok: true }
# Equivalent WS: inject_task

POST /api/v1/orchestra/boards/:boardId/nodes/:nodeId/input
Body: { data: string }     # raw terminal bytes
→ { ok: true }
# Equivalent WS: pty_input

POST /api/v1/orchestra/boards/:boardId/stop
→ { ok: true, killed: number }
# Equivalent WS: stop_board

POST /api/v1/orchestra/boards/:boardId/nodes/:nodeId/stop
→ { ok: true }
# Equivalent WS: abort_node
```

### Status

```http
GET /api/v1/orchestra/boards/:boardId/status
→ {
  boardId,
  nodes: [{ nodeId, label, status, startedAt? }],
  edges: [{ sourceNodeId, targetNodeId }]
}
```

### High-level flow helper (CI / hosts)

```http
POST /api/v1/orchestra/flows
Body: {
  name: string,
  cwd: string,
  entryNodeId: string,
  graph: WorkflowGraph,
  message: string,
  wait?: boolean              # block until entry node PTY exits
}
→ {
  ok: true,
  boardId,
  flowId,
  status: "running" | "done",
  summary?: string
}
```

---

## Planned — CLI

```bash
pi-orchestra run --cwd ./my-repo --workflow <id> --message "Implement feature X"
pi-orchestra run --graph flow.json --entry <nodeId> --message "..."
pi-orchestra status --board <boardId>
pi-orchestra stop --board <boardId>
```

Wraps the REST API above. Useful for OpenClaw cron, Hermes scripts, CI.

---

## WebSocket (live control — implemented)

Connect: `ws://localhost:3847/ws`

Prefer WebSocket for:

- streaming `pty_output`
- low-latency `pty_input`
- UI sync

Prefer REST for:

- CRUD workflows/prompts
- CI one-shot `flows` creation
- host integrations without persistent socket

### Example: programmatic flow start (today, via WS)

```javascript
const ws = new WebSocket("ws://localhost:3847/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "load_graph",
    boardId: "ci-board",
    cwd: "/path/to/repo",
    graph: {
      name: "CI flow",
      nodes: [
        { id: "arch", label: "Architect", promptId: "builtin-architect", position: { x: 0, y: 0 } },
        { id: "dev", label: "Developer", promptId: "builtin-developer", position: { x: 300, y: 0 } },
      ],
      edges: [
        { id: "e1", sourceNodeId: "arch", targetNodeId: "dev" },
      ],
      entryNodeId: "arch",
    },
  }));

  ws.send(JSON.stringify({
    type: "inject_task",
    boardId: "ci-board",
    nodeId: "arch",
    message: "Design the auth module for project X",
  }));
};
```

---

## Planned — node runtime field

```typescript
interface WorkflowNode {
  // ...existing fields
  runtime?: "pi" | "cursor" | "hermes" | "openclaw";
  runtimeConfig?: Record<string, unknown>;
}
```

| runtime | spawn |
|---------|-------|
| `pi` (default) | `pi` CLI via PtyHub |
| `cursor` | Cursor agent via SDK / CLI bridge |
| `hermes` | TUI gateway session |
| `openclaw` | Gateway `agent` RPC |

---

## Auth (future)

Standalone v1: no auth (localhost only).

For remote hosts:

```
Authorization: Bearer <token>
# or
X-Pi-Orchestra-Token: <shared-secret>
```

Hermes/OpenClaw plugins would inject the token when opening the Orchestra tab.

---

## Implementation priority

| Endpoint group | Priority | Reason |
|----------------|----------|--------|
| `PUT .../graph` + `POST .../run` | P0 | Unblocks all host tabs |
| `GET .../status` | P0 | Host health display |
| `POST /flows` | P1 | CI one-shot |
| CLI | P2 | Scripting ergonomics |
| Auth | P2 | Remote dashboard embed |

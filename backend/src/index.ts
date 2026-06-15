import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPrompt,
  deletePrompt,
  deleteWorkflow,
  getWorkflow,
  listPrompts,
  listWorkflows,
  saveWorkflow,
  updatePrompt,
} from "./db/index.js";
import { ptyHub } from "./pty/PtyHub.js";
import type { WorkflowGraph } from "./types.js";
import { attachWebSocket } from "./ws/handler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT ?? 3847);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/api/health", async () => ({
  ok: true,
  name: "pi-orchestra",
  version: "0.1.0",
  port: PORT,
}));

/** Server info for clients that need a sensible default cwd (browser has no process.cwd). */
app.get("/api/info", async () => ({
  ok: true,
  name: "pi-orchestra",
  version: "0.1.0",
  port: PORT,
  defaultCwd: process.cwd(),
  wsPath: "/ws",
}));

// Called by the call_agent extension running inside a node's pi terminal.
app.post<{
  Body: { boardId: string; fromNodeId: string; targetNodeId: string; message: string };
}>("/internal/call-agent", async (req) => {
  const { boardId, fromNodeId, targetNodeId, message } = req.body;
  return ptyHub.deliverCall(boardId, fromNodeId, targetNodeId, message);
});

// Called by the extension when an agent advances the linked Kanban card.
app.post<{ Body: { boardId: string; column: string } }>(
  "/internal/card-status",
  async (req) => {
    const { boardId, column } = req.body;
    ptyHub.notify({ type: "card_status", boardId, column });
    return { ok: true };
  },
);

app.post<{ Body: { path: string } }>("/api/validate-path", async (req, reply) => {
  const resolved = path.resolve(req.body.path);
  if (!fs.existsSync(resolved)) {
    return reply.code(404).send({ ok: false, path: resolved, error: "Path not found" });
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return reply.code(400).send({ ok: false, path: resolved, error: "Not a directory" });
  }
  return { ok: true, path: resolved };
});

app.get("/api/prompts", async () => listPrompts());

app.post<{ Body: { name: string; content: string } }>(
  "/api/prompts",
  async (req) => {
    const id = crypto.randomUUID();
    return createPrompt(id, req.body.name, req.body.content);
  },
);

app.put<{ Params: { id: string }; Body: { name: string; content: string } }>(
  "/api/prompts/:id",
  async (req, reply) => {
    const row = updatePrompt(req.params.id, req.body.name, req.body.content);
    if (!row) return reply.code(404).send({ error: "Not found" });
    return row;
  },
);

app.delete<{ Params: { id: string } }>("/api/prompts/:id", async (req, reply) => {
  if (!deletePrompt(req.params.id)) return reply.code(400).send({ error: "Cannot delete" });
  return { ok: true };
});

app.get("/api/workflows", async () => listWorkflows());

app.get<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
  const wf = getWorkflow(req.params.id);
  if (!wf) return reply.code(404).send({ error: "Not found" });
  return wf;
});

app.post<{ Body: WorkflowGraph }>("/api/workflows", async (req) => saveWorkflow(req.body));

app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
  if (!deleteWorkflow(req.params.id)) return reply.code(404).send({ error: "Not found" });
  return { ok: true };
});

app.register(async (f) => {
  f.get("/ws", { websocket: true }, (socket) => {
    attachWebSocket(socket);
  });
});

const frontendDist = path.join(ROOT, "frontend", "dist");
try {
  await app.register(fastifyStatic, { root: frontendDist, prefix: "/" });
  app.setNotFoundHandler((_req, reply) => {
    reply.sendFile("index.html", frontendDist);
  });
} catch {
  // frontend not built yet
}

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`pi-orchestra backend http://localhost:${PORT}`);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pty, { type IPty } from "node-pty";
import { getPrompt } from "../db/index.js";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_BUFFER = 256_000; // scrollback kept per node for re-attach
const PORT = Number(
  process.env.PI_ORCHESTRA_PORT ?? process.env.PORT ?? 3847,
);
const BASE_URL =
  process.env.PI_ORCHESTRA_URL ?? `http://localhost:${PORT}`;
const EXTENSION_PATH = path.resolve(__dirname, "../../pi-extensions/call-agent.ts");

type BroadcastFn = (msg: Record<string, unknown>) => void;

interface BoardGraph {
  cwd: string;
  nodes: Map<string, WorkflowNode>;
  edges: WorkflowEdge[];
}

interface Session {
  pty: IPty;
  buffer: string;
  cols: number;
  rows: number;
  startedAt: number;
}

/** Search an executable in PATH. */
function findInPath(name: string): string | undefined {
  const pathVar = process.env.PATH ?? "";
  for (const dir of pathVar.split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return undefined;
}

/** Resolve the `pi` CLI entry, falling back to the binary on PATH. */
function resolvePiCommand(): { file: string; baseArgs: string[] } {
  const candidates = [
    path.resolve(__dirname, "../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    path.resolve(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { file: process.execPath, baseArgs: [c] };
  }
  const piBin = findInPath("pi");
  if (piBin) return { file: piBin, baseArgs: [] };
  console.error(
    "pi-orchestra: pi CLI not found. Install `@earendil-works/pi-coding-agent` globally (npm i -g) " +
      "or run `npm install` in the `backend` folder.",
  );
  return { file: "pi", baseArgs: [] };
}

function key(boardId: string, nodeId: string): string {
  return `${boardId}:${nodeId}`;
}

export class PtyHub {
  private broadcast: BroadcastFn = () => {};
  private graphs = new Map<string, BoardGraph>();
  private sessions = new Map<string, Session>();
  private pending = new Map<string, { cols: number; rows: number }>();
  private kanbanBoards = new Set<string>();
  private cmd = resolvePiCommand();

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  /** Relay an arbitrary message to all clients (used by HTTP internal hooks). */
  notify(msg: Record<string, unknown>): void {
    this.broadcast(msg);
  }

  /** Mark a board as Kanban-tracked so its agents learn to move the card. */
  setKanbanTracked(boardId: string): void {
    this.kanbanBoards.add(boardId);
  }

  /** Store node + edge metadata and cwd for a board. Kills terminals of removed nodes. */
  setGraph(boardId: string, graph: WorkflowGraph, cwd: string): void {
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    this.graphs.set(boardId, { cwd, nodes, edges: graph.edges ?? [] });
    for (const k of [...this.sessions.keys()]) {
      const [b, nodeId] = k.split(":");
      if (b === boardId && !nodes.has(nodeId)) this.kill(boardId, nodeId);
    }
    // Spawn terminals that were requested before this board's graph arrived.
    for (const [k, size] of [...this.pending]) {
      const [b, nodeId] = k.split(":");
      if (b === boardId && nodes.has(nodeId)) {
        this.pending.delete(k);
        this.spawn(boardId, nodeId, size.cols, size.rows);
      }
    }
  }

  private outgoingTargets(boardId: string, nodeId: string): WorkflowNode[] {
    const graph = this.graphs.get(boardId);
    if (!graph) return [];
    const targetIds = graph.edges
      .filter((e) => e.sourceNodeId === nodeId)
      .map((e) => e.targetNodeId);
    return targetIds
      .map((id) => graph.nodes.get(id))
      .filter((n): n is WorkflowNode => Boolean(n));
  }

  private hasEdge(boardId: string, from: string, to: string): boolean {
    const graph = this.graphs.get(boardId);
    return Boolean(graph?.edges.some((e) => e.sourceNodeId === from && e.targetNodeId === to));
  }

  /** System-prompt appendix telling an agent which nodes it may hand off to. */
  private connectionsAppendix(boardId: string, nodeId: string): string {
    const targets = this.outgoingTargets(boardId, nodeId);
    if (targets.length === 0) {
      return (
        "\n\n## Orchestration\n" +
        "You have no outgoing connected agents: carry the task through to completion yourself.\n"
      );
    }
    const lines = targets.map((t) => `- ${t.id} — ${t.label}`).join("\n");
    return (
      "\n\n## Orchestration — you are one link in a pipeline of agents\n" +
      "CORE RULE: do ONLY your part of the work. Do NOT do the work of downstream " +
      "agents: when your part is ready, DELEGATE the next step to the right connected agent. " +
      "Do not respond as if you were the only executor.\n\n" +
      "Agents you can hand work off to (outgoing):\n" +
      lines +
      "\n\nTo delegate, end your message with a hand-off block in EXACTLY this " +
      "format (no backticks, no text after @@END):\n\n" +
      "@@HANDOFF:<recipient-node-id>\n" +
      "<complete, self-contained instructions: what you produced, files touched, what they must do>\n" +
      "@@END\n\n" +
      "Example: an architect designs and then hands off to the developer with @@HANDOFF; the developer " +
      "implements and hands off to the auditor; the auditor reviews and closes. The system delivers the task " +
      "automatically into the recipient's terminal. If the work is truly finished and there is no " +
      "next step, do not write the block.\n"
    );
  }

  /** Appendix telling agents to advance the linked Kanban card by real state. */
  private kanbanAppendix(): string {
    return (
      "\n\n## Kanban — advancing the card\n" +
      "This work is tracked on a Kanban board with columns: To Do, In Progress, Test, Review, Done.\n" +
      "When the real state of the work changes, move the card by writing on its own line:\n\n" +
      "@@CARD:<column>\n\n" +
      "Valid columns: todo, in_progress, test, review, done. Move the card to the state that truly " +
      "reflects the work (e.g. `@@CARD:test` when the code is ready for testing, `@@CARD:review` " +
      "when it needs reviewing, `@@CARD:done` when the work is finished). You can also use it together with a " +
      "@@HANDOFF block in the same message.\n"
    );
  }

  /**
   * Return a node's scrollback, spawning its pi terminal if needed.
   * With spawnIfMissing=false it only mirrors an already-running session (used
   * by the read-only mini terminals so they never spawn a pi before the board's
   * graph — hence the right prompt/cwd — has reached the backend).
   */
  ensure(
    boardId: string,
    nodeId: string,
    cols: number,
    rows: number,
    spawnIfMissing = true,
  ): string {
    const k = key(boardId, nodeId);
    const existing = this.sessions.get(k);
    if (existing) {
      if (cols && rows && (cols !== existing.cols || rows !== existing.rows)) {
        this.resize(boardId, nodeId, cols, rows);
      }
      return existing.buffer;
    }
    if (!spawnIfMissing) return "";
    const graph = this.graphs.get(boardId);
    if (!graph || !graph.nodes.has(nodeId)) {
      // Graph not synced yet → defer the spawn so pi gets the right prompt/cwd.
      this.pending.set(k, { cols: cols || 80, rows: rows || 24 });
      return "";
    }
    this.spawn(boardId, nodeId, cols || 80, rows || 24);
    return "";
  }

  private spawn(boardId: string, nodeId: string, cols: number, rows: number): void {
    const graph = this.graphs.get(boardId);
    const node = graph?.nodes.get(nodeId);
    const cwd = graph?.cwd && fs.existsSync(graph.cwd) ? graph.cwd : process.cwd();

    let systemPrompt = "";
    if (node) {
      const row = getPrompt(node.promptId);
      systemPrompt = (node.promptOverride?.trim() || row?.content || "").trim();
    }
    systemPrompt += this.connectionsAppendix(boardId, nodeId);
    if (this.kanbanBoards.has(boardId)) systemPrompt += this.kanbanAppendix();

    const args = [
      ...this.cmd.baseArgs,
      "--tools",
      "read,bash,edit,write,grep",
      "--session-id",
      `${boardId}-${nodeId}`.replace(/[^a-zA-Z0-9-]/g, ""),
      "--name",
      node?.label ?? "pi",
      "--system-prompt",
      systemPrompt.trim(),
    ];
    if (fs.existsSync(EXTENSION_PATH)) args.push("--extension", EXTENSION_PATH);

    console.log("pi-orchestra: spawning pi", this.cmd.file, args);
    const term = pty.spawn(this.cmd.file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        PI_ORCHESTRA_URL: BASE_URL,
        PI_ORCHESTRA_BOARD: boardId,
        PI_ORCHESTRA_NODE: nodeId,
      } as Record<string, string>,
    });

    const session: Session = { pty: term, buffer: "", cols, rows, startedAt: Date.now() };
    const k = key(boardId, nodeId);
    this.sessions.set(k, session);
    this.broadcast({ type: "node_status", boardId, nodeId, status: "running" });

    term.onData((data) => {
      session.buffer = (session.buffer + data).slice(-MAX_BUFFER);
      this.broadcast({ type: "pty_output", boardId, nodeId, data });
    });

    term.onExit(({ exitCode }) => {
      // Only clear if this exact session is still the active one (guards restart).
      if (this.sessions.get(k) === session) this.sessions.delete(k);
      this.broadcast({ type: "pty_exit", boardId, nodeId, code: exitCode });
      this.broadcast({ type: "node_status", boardId, nodeId, status: "idle" });
    });
  }

  input(boardId: string, nodeId: string, data: string): void {
    this.sessions.get(key(boardId, nodeId))?.pty.write(data);
  }

  /**
   * Deliver a task from one node to a connected one (call_agent). Validates the
   * edge, ensures the target terminal is running, and types the task into it.
   * Returns immediately; injection happens once the target's pi is ready.
   */
  deliverCall(
    boardId: string,
    fromNodeId: string,
    targetNodeId: string,
    message: string,
  ): { ok: boolean; message?: string; error?: string } {
    if (!this.hasEdge(boardId, fromNodeId, targetNodeId)) {
      return {
        ok: false,
        error: `No edge ${fromNodeId} → ${targetNodeId}. Connect the two nodes on the canvas.`,
      };
    }
    const target = this.graphs.get(boardId)?.nodes.get(targetNodeId);
    if (!target) return { ok: false, error: `Recipient node not found: ${targetNodeId}` };

    this.scheduleInject(boardId, targetNodeId, message);

    return {
      ok: true,
      message: `Task delivered to ${target.label}. It is working in its terminal.`,
    };
  }

  /**
   * Feed a task into a node's pi terminal directly (e.g. launched from a Kanban
   * card). No edge check — it's a user-initiated start, not an agent hand-off.
   */
  injectTask(boardId: string, nodeId: string, message: string): void {
    this.scheduleInject(boardId, nodeId, message);
  }

  /** Ensure the node is running, then inject once its pi has had time to boot. */
  private scheduleInject(boardId: string, nodeId: string, message: string): void {
    this.ensure(boardId, nodeId, 80, 24);
    const s = this.sessions.get(key(boardId, nodeId));
    const age = s ? Date.now() - s.startedAt : 0;
    // A freshly spawned pi needs ~3s to boot before it accepts input.
    const delay = Math.max(150, 3000 - age);
    setTimeout(() => this.inject(boardId, nodeId, message), delay);
  }

  /** Type text into a node's pi editor as a bracketed paste, then submit. */
  private inject(boardId: string, nodeId: string, message: string): void {
    const s = this.sessions.get(key(boardId, nodeId));
    if (!s) return;
    // Bracketed paste keeps embedded newlines from submitting early.
    s.pty.write(`\x1b[200~${message}\x1b[201~`);
    setTimeout(() => this.sessions.get(key(boardId, nodeId))?.pty.write("\r"), 80);
  }

  resize(boardId: string, nodeId: string, cols: number, rows: number): void {
    const s = this.sessions.get(key(boardId, nodeId));
    if (!s || !cols || !rows) return;
    s.cols = cols;
    s.rows = rows;
    try {
      s.pty.resize(cols, rows);
    } catch {
      // terminal may have just exited
    }
  }

  /** Kill and respawn a node's terminal (fresh pi session). */
  restart(boardId: string, nodeId: string, cols: number, rows: number): void {
    this.kill(boardId, nodeId);
    this.spawn(boardId, nodeId, cols || 80, rows || 24);
  }

  kill(boardId: string, nodeId: string): void {
    const k = key(boardId, nodeId);
    const s = this.sessions.get(k);
    if (!s) return;
    this.sessions.delete(k);
    try {
      s.pty.kill();
    } catch {
      // already gone
    }
  }

  killBoard(boardId: string): void {
    for (const k of [...this.sessions.keys()]) {
      if (k.startsWith(`${boardId}:`)) {
        const [, nodeId] = k.split(":");
        this.kill(boardId, nodeId);
      }
    }
  }
}

export const ptyHub = new PtyHub();

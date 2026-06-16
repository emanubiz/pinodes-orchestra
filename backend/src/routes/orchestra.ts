import type { FastifyInstance } from "fastify";
import { BoardManager } from "../orchestra/BoardManager.js";
import { ptyHub } from "../pty/PtyHub.js";
import type { WorkflowGraph } from "../types.js";

function checkAuth(req: { headers: Record<string, string | string[] | undefined> }, reply: {
  code: (code: number) => { send: (payload: unknown) => void };
}): boolean {
  const token = process.env.PINODES_ORCHESTRA_TOKEN;
  if (!token) return true;
  const header = req.headers["x-pinodes-orchestra-token"];
  const auth = req.headers.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const provided = typeof header === "string" ? header : bearer;
  if (provided !== token) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export function createOrchestraRoutes(boardManager: BoardManager) {
  return async function orchestraRoutes(app: FastifyInstance): Promise<void> {
    app.addHook("preHandler", async (req, reply) => {
      if (!checkAuth(req, reply)) {
        return reply;
      }
    });

    app.post<{ Body: { cwd: string; label?: string } }>(
      "/boards",
      async (req, reply) => {
        const cwd = req.body.cwd;
        if (!cwd || typeof cwd !== "string") {
          return reply.code(400).send({ error: "cwd is required" });
        }
        try {
          const board = boardManager.create(cwd, req.body.label);
          return { boardId: board.boardId, cwd: board.cwd, label: board.label };
        } catch (err) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    );

    app.get("/boards", async () => ({ boards: boardManager.list() }));

    app.delete<{ Params: { boardId: string } }>(
      "/boards/:boardId",
      async (req, reply) => {
        const ok = boardManager.delete(req.params.boardId);
        if (!ok) return reply.code(404).send({ error: "Board not found" });
        return { ok: true };
      },
    );

    app.put<{ Params: { boardId: string }; Body: WorkflowGraph }>(
      "/boards/:boardId/graph",
      async (req, reply) => {
        const board = boardManager.get(req.params.boardId);
        if (!board) return reply.code(404).send({ error: "Board not found" });
        try {
          boardManager.setGraph(req.params.boardId, req.body);
          return {
            ok: true,
            nodeIds: req.body.nodes.map((n) => n.id),
          };
        } catch (err) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    );

    app.get<{ Params: { boardId: string } }>(
      "/boards/:boardId/graph",
      async (req, reply) => {
        const graph = boardManager.getGraph(req.params.boardId);
        if (!graph) return reply.code(404).send({ error: "Graph not found" });
        return graph;
      },
    );

    app.post<{
      Params: { boardId: string };
      Body: { nodeId?: string; message: string };
    }>("/boards/:boardId/run", async (req, reply) => {
      const board = boardManager.get(req.params.boardId);
      if (!board) return reply.code(404).send({ error: "Board not found" });
      const message = req.body.message;
      if (!message || typeof message !== "string") {
        return reply.code(400).send({ error: "message is required" });
      }
      try {
        const { nodeId } = boardManager.run(
          req.params.boardId,
          req.body.nodeId,
          message,
        );
        return { ok: true, boardId: req.params.boardId, nodeId };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.post<{ Params: { boardId: string } }>(
      "/boards/:boardId/stop",
      async (req, reply) => {
        const result = boardManager.stop(req.params.boardId);
        if (!result.ok) return reply.code(404).send({ error: "Board not found" });
        return { ok: true, killed: result.killed };
      },
    );

    app.get<{ Params: { boardId: string } }>(
      "/boards/:boardId/status",
      async (req, reply) => {
        try {
          return boardManager.status(req.params.boardId);
        } catch (err) {
          return reply
            .code(404)
            .send({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    );

    app.post<{
      Params: { boardId: string; nodeId: string };
    }>("/boards/:boardId/nodes/:nodeId/stop", async (req, reply) => {
      try {
        boardManager.stopNode(req.params.boardId, req.params.nodeId);
        return { ok: true };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.post<{
      Params: { boardId: string; nodeId: string };
      Body: { message: string };
    }>("/boards/:boardId/nodes/:nodeId/inject", async (req, reply) => {
      const message = req.body.message;
      if (!message || typeof message !== "string") {
        return reply.code(400).send({ error: "message is required" });
      }
      try {
        boardManager.injectNode(req.params.boardId, req.params.nodeId, message);
        return { ok: true };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.post<{
      Params: { boardId: string; nodeId: string };
      Body: { data: string };
    }>("/boards/:boardId/nodes/:nodeId/input", async (req, reply) => {
      const data = req.body.data;
      if (typeof data !== "string") {
        return reply.code(400).send({ error: "data is required" });
      }
      try {
        boardManager.inputNode(req.params.boardId, req.params.nodeId, data);
        return { ok: true };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.post<{
      Body: {
        name: string;
        cwd: string;
        entryNodeId?: string;
        graph: WorkflowGraph;
        message: string;
        wait?: boolean;
        waitTimeoutMs?: number;
      };
    }>("/flows", async (req, reply) => {
      const { name, cwd, graph, message } = req.body;
      if (!name || typeof name !== "string") {
        return reply.code(400).send({ error: "name is required" });
      }
      if (!cwd || typeof cwd !== "string") {
        return reply.code(400).send({ error: "cwd is required" });
      }
      if (!graph || typeof graph !== "object" || !graph.nodes) {
        return reply.code(400).send({ error: "graph is required" });
      }
      if (!message || typeof message !== "string") {
        return reply.code(400).send({ error: "message is required" });
      }

      let board;
      try {
        board = boardManager.create(cwd, name);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }

      const loadedGraph: WorkflowGraph = {
        ...graph,
        name,
        cwd,
        entryNodeId: req.body.entryNodeId ?? graph.entryNodeId,
      };
      try {
        boardManager.setGraph(board.boardId, loadedGraph);
      } catch (err) {
        boardManager.delete(board.boardId);
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }

      const { nodeId } = boardManager.run(
        board.boardId,
        loadedGraph.entryNodeId ?? undefined,
        message,
      );

      if (req.body.wait) {
        const result = await boardManager.waitForExit(
          board.boardId,
          nodeId,
          req.body.waitTimeoutMs ?? 120_000,
        );
        return {
          ok: true,
          boardId: board.boardId,
          flowId: board.boardId,
          status: result.timedOut ? "running" : "done",
          nodeId,
          timedOut: result.timedOut,
        };
      }

      return {
        ok: true,
        boardId: board.boardId,
        flowId: board.boardId,
        status: "running",
        nodeId,
      };
    });
  };
}

const defaultBoardManager = new BoardManager(ptyHub);
export const orchestraRoutes = createOrchestraRoutes(defaultBoardManager);

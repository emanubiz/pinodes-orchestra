import fs from "node:fs";
import path from "node:path";
import {
  createBoard as dbCreateBoard,
  deleteBoard as dbDeleteBoard,
  getBoard as dbGetBoard,
  listBoards as dbListBoards,
  saveBoardGraph as dbSaveBoardGraph,
} from "../db/index.js";
import type { PtyHub } from "../pty/PtyHub.js";
import type { BoardState, WorkflowGraph } from "../types.js";

export interface BoardListItem {
  boardId: string;
  cwd: string;
  label: string;
  nodeCount: number;
  runningCount: number;
}

export class BoardManager {
  private boards = new Map<string, BoardState>();

  constructor(private ptyHub: PtyHub) {
    // Re-hydrate boards from SQLite and replay their graphs into PtyHub so
    // status, handles and handoff resolution work immediately after restart.
    for (const b of dbListBoards()) {
      this.boards.set(b.boardId, b);
      if (b.graph) {
        this.ptyHub.setGraph(b.boardId, b.graph, b.graph.cwd || b.cwd);
      }
    }
  }

  private resolveCwd(cwd: string): string {
    const resolved = path.resolve(cwd);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Not a valid directory: ${cwd}`);
    }
    return resolved;
  }

  private getNode(boardId: string, nodeId: string) {
    const board = this.boards.get(boardId);
    if (!board) throw new Error(`Board not found: ${boardId}`);
    const graph = board.graph;
    if (!graph) throw new Error(`No graph loaded for board: ${boardId}`);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node not found in graph: ${nodeId}`);
    return { board, graph, node };
  }

  create(cwd: string, label?: string): BoardState {
    const resolved = this.resolveCwd(cwd);
    const finalLabel = label ?? cwd.split("/").filter(Boolean).pop() ?? "board";
    const boardId = crypto.randomUUID();
    const board = dbCreateBoard(boardId, resolved, finalLabel);
    this.boards.set(board.boardId, board);
    return board;
  }

  list(): BoardListItem[] {
    return [...this.boards.values()].map((b) => ({
      boardId: b.boardId,
      cwd: b.cwd,
      label: b.label,
      nodeCount: b.graph?.nodes.length ?? 0,
      runningCount: (b.graph?.nodes ?? []).filter((n) =>
        this.ptyHub.isNodeRunning(b.boardId, n.id),
      ).length,
    }));
  }

  get(boardId: string): BoardState | undefined {
    return this.boards.get(boardId);
  }

  delete(boardId: string): boolean {
    if (!this.boards.has(boardId)) return false;
    this.ptyHub.killBoard(boardId);
    dbDeleteBoard(boardId);
    this.boards.delete(boardId);
    return true;
  }

  setGraph(boardId: string, graph: WorkflowGraph): BoardState {
    const board = this.boards.get(boardId);
    if (!board) throw new Error(`Board not found: ${boardId}`);
    const cwd = graph.cwd && graph.cwd.trim() ? this.resolveCwd(graph.cwd.trim()) : board.cwd;
    const graphWithCwd: WorkflowGraph = { ...graph, cwd };
    const saved = dbSaveBoardGraph(boardId, graphWithCwd);
    if (!saved) throw new Error(`Failed to save graph for board: ${boardId}`);
    this.boards.set(boardId, saved);
    this.ptyHub.setGraph(boardId, graphWithCwd, cwd);
    return saved;
  }

  getGraph(boardId: string): WorkflowGraph | undefined {
    return this.boards.get(boardId)?.graph;
  }

  /**
   * Inject a message into a node. If `nodeId` is omitted, the board's entry
   * node is used. The target node must exist in the loaded graph.
   */
  run(boardId: string, nodeId: string | undefined, message: string): { nodeId: string } {
    const board = this.boards.get(boardId);
    if (!board) throw new Error(`Board not found: ${boardId}`);
    const graph = board.graph;
    if (!graph) throw new Error(`No graph loaded for board: ${boardId}`);
    const targetId = nodeId ?? graph.entryNodeId ?? undefined;
    if (!targetId) {
      throw new Error(`No target node specified and board has no entryNodeId`);
    }
    const node = graph.nodes.find((n) => n.id === targetId);
    if (!node) throw new Error(`Node not found in graph: ${targetId}`);

    this.ptyHub.ensure(boardId, targetId, 80, 24);
    this.ptyHub.injectTask(boardId, targetId, message);
    return { nodeId: targetId };
  }

  stop(boardId: string): { ok: boolean; killed: number } {
    if (!this.boards.has(boardId)) return { ok: false, killed: 0 };
    const killed = this.ptyHub
      .getNodeStatuses(boardId)
      .filter((n) => n.status === "running").length;
    this.ptyHub.killBoard(boardId);
    return { ok: true, killed };
  }

  stopNode(boardId: string, nodeId: string): { ok: boolean } {
    this.getNode(boardId, nodeId);
    this.ptyHub.kill(boardId, nodeId);
    return { ok: true };
  }

  injectNode(boardId: string, nodeId: string, message: string): { ok: boolean } {
    this.getNode(boardId, nodeId);
    this.ptyHub.ensure(boardId, nodeId, 80, 24);
    this.ptyHub.injectTask(boardId, nodeId, message);
    return { ok: true };
  }

  inputNode(boardId: string, nodeId: string, data: string): { ok: boolean } {
    this.getNode(boardId, nodeId);
    this.ptyHub.input(boardId, nodeId, data);
    return { ok: true };
  }

  status(boardId: string) {
    const board = this.boards.get(boardId);
    if (!board) throw new Error(`Board not found: ${boardId}`);
    return {
      boardId,
      cwd: board.cwd,
      label: board.label,
      nodes: this.ptyHub.getNodeStatuses(boardId),
      edges: this.ptyHub.getEdges(boardId),
    };
  }

  waitForExit(
    boardId: string,
    nodeId: string,
    timeoutMs?: number,
  ): Promise<{ code: number | null; timedOut: boolean }> {
    return this.ptyHub.waitForExit(boardId, nodeId, timeoutMs);
  }
}

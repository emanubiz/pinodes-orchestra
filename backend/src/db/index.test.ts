import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let testDir: string;

describe("board persistence", () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestra-db-"));
    process.env.PI_ORCHESTRA_DATA_DIR = testDir;
  });

  afterEach(() => {
    delete process.env.PI_ORCHESTRA_DATA_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  async function loadDb() {
    const mod = await import("./index.js");
    return mod;
  }

  it("creates and retrieves a board", async () => {
    const { createBoard, getBoard } = await loadDb();
    const board = createBoard("b1", "/tmp", "Test");
    expect(board.boardId).toBe("b1");
    expect(board.cwd).toBe("/tmp");
    expect(board.label).toBe("Test");
    expect(getBoard("b1")).toEqual(board);
  });

  it("lists boards ordered by updated_at", async () => {
    const { createBoard, listBoards } = await loadDb();
    createBoard("b1", "/tmp/a", "A");
    createBoard("b2", "/tmp/b", "B");
    const list = listBoards();
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.boardId)).toEqual(expect.arrayContaining(["b1", "b2"]));
  });

  it("saves and retrieves a graph", async () => {
    const { createBoard, saveBoardGraph, getBoard } = await loadDb();
    createBoard("b1", "/tmp", "Test");
    const graph = {
      name: "g",
      cwd: "/tmp",
      entryNodeId: "n1",
      nodes: [{ id: "n1", label: "N", promptId: "p", position: { x: 0, y: 0 } }],
      edges: [],
    };
    const updated = saveBoardGraph("b1", graph);
    expect(updated?.graph).toEqual(graph);
    expect(getBoard("b1")?.graph).toEqual(graph);
  });

  it("returns undefined for unknown board", async () => {
    const { getBoard, saveBoardGraph, deleteBoard } = await loadDb();
    expect(getBoard("missing")).toBeUndefined();
    expect(saveBoardGraph("missing", { name: "x", nodes: [], edges: [] })).toBeUndefined();
    expect(deleteBoard("missing")).toBe(false);
  });

  it("deletes a board", async () => {
    const { createBoard, deleteBoard, getBoard } = await loadDb();
    createBoard("b1", "/tmp", "Test");
    expect(deleteBoard("b1")).toBe(true);
    expect(getBoard("b1")).toBeUndefined();
  });
});

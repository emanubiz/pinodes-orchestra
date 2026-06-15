import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type TurnEndCallback = (event: { message: unknown }) => void | Promise<void>;

function createMockPi() {
  const handlers: Record<string, TurnEndCallback[]> = {};
  return {
    on: vi.fn((event: string, cb: TurnEndCallback) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(cb);
      return { off: vi.fn() };
    }),
    _emit(event: string, payload: { message: unknown }) {
      (handlers[event] ?? []).forEach((cb) => cb(payload));
    },
    _handlers: handlers,
  };
}

function assistantMessage(content: string) {
  return { role: "assistant", content };
}

async function loadExtension() {
  const { default: handoffExtension } = await import("./call-agent.js");
  return handoffExtension;
}

describe("handoffExtension", () => {
  beforeEach(() => {
    process.env.PI_ORCHESTRA_URL = "http://localhost:3847";
    process.env.PI_ORCHESTRA_BOARD = "board-1";
    process.env.PI_ORCHESTRA_NODE = "node-a";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PI_ORCHESTRA_URL;
    delete process.env.PI_ORCHESTRA_BOARD;
    delete process.env.PI_ORCHESTRA_NODE;
  });

  it("delivers a handoff block to the target node", async () => {
    const pi = createMockPi();
    const handoffExtension = await loadExtension();
    handoffExtension(pi as never);

    const fetchMock = vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    pi._emit("turn_end", {
      message: assistantMessage(
        "Plan done.\n@@HANDOFF:developer-1\nImplement the auth module.\n@@END",
      ),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3847/internal/call-agent",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          boardId: "board-1",
          fromNodeId: "node-a",
          targetNodeId: "developer-1",
          message: "Implement the auth module.",
        }),
      }),
    );
  });

  it("does not deliver the same handoff twice", async () => {
    const pi = createMockPi();
    const handoffExtension = await loadExtension();
    handoffExtension(pi as never);

    const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const msg = assistantMessage(
      "@@HANDOFF:developer-1\nImplement the auth module.\n@@END",
    );
    pi._emit("turn_end", { message: msg });
    pi._emit("turn_end", { message: msg });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("reports card moves to /internal/card-status", async () => {
    const pi = createMockPi();
    const handoffExtension = await loadExtension();
    handoffExtension(pi as never);

    const fetchMock = vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    pi._emit("turn_end", {
      message: assistantMessage("Ready for review.\n@@CARD:review\n"),
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3847/internal/card-status",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ boardId: "board-1", column: "review" }),
      }),
    );
  });

  it("ignores non-assistant messages", async () => {
    const pi = createMockPi();
    const handoffExtension = await loadExtension();
    handoffExtension(pi as never);

    const fetchMock = vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    pi._emit("turn_end", { message: { role: "user", content: "@@HANDOFF:x\ny\n@@END" } });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("extracts text from array content", async () => {
    const pi = createMockPi();
    const handoffExtension = await loadExtension();
    handoffExtension(pi as never);

    const fetchMock = vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    pi._emit("turn_end", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "@@HANDOFF:dev\nGo.\n@@END" }],
      },
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).message).toBe("Go.");
  });

  it("does not call when target or message is empty", async () => {
    const pi = createMockPi();
    const handoffExtension = await loadExtension();
    handoffExtension(pi as never);

    const fetchMock = vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    pi._emit("turn_end", {
      message: assistantMessage("@@HANDOFF:\n\n@@END"),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

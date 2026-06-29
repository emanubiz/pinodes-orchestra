import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTimelineCapture } from "./useTimelineCapture";
import { useTimelineStore } from "../stores/timelineStore";

// The timeline capture records handoffs from the canonical `handoff` event
// emitted by the backend's PtyHub.deliverCall, and errors from `node_status:
// error`. It must NOT infer handoffs from `node_status: running` timestamps
// (the old 8s heuristic — it missed real handoffs whose upstream worked >8s
// and invented false positives on manual starts). It must also NOT produce
// done / inject / turn_end entries — the backend emits no such signal for
// the timeline, so those branches would be dead code promising UI the
// transport can't deliver.

describe("useTimelineCapture", () => {
  beforeEach(() => {
    act(() => useTimelineStore.setState({ entries: {} }));
  });

  const labels = { n1: "Alpha", n2: "Beta" };

  function capture(boardId = "b1") {
    return renderHook(() => useTimelineCapture(boardId, labels)).result.current;
  }

  it("records a handoff from the backend's canonical `handoff` event", () => {
    const fn = capture();
    act(() => {
      fn({ type: "handoff", boardId: "b1", fromNodeId: "n1", toNodeId: "n2" });
    });
    const entries = useTimelineStore.getState().getByBoard("b1");
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("handoff");
    expect(entries[0].summary).toBe("Alpha → Beta");
    expect(entries[0].fromNodeId).toBe("n1");
    expect(entries[0].toNodeId).toBe("n2");
    expect(entries[0].nodeId).toBe("n2");
  });

  it("does NOT infer a handoff from node_status: running (no heuristic)", () => {
    const fn = capture();
    // Two nodes go running in quick succession, edge n1→n2 exists in the graph
    // but the capture no longer receives edges and must not guess.
    act(() => {
      fn({ type: "node_status", boardId: "b1", nodeId: "n1", status: "running" });
      fn({ type: "node_status", boardId: "b1", nodeId: "n2", status: "running" });
    });
    expect(useTimelineStore.getState().getByBoard("b1")).toHaveLength(0);
  });

  it("records a handoff even when the upstream worked for a long time", () => {
    // Regression for the old 8s-window bug: a real handoff after 30s of
    // upstream work must still be recorded, because it now comes from the
    // backend signal, not a timestamp delta.
    const fn = capture();
    act(() => {
      fn({ type: "node_status", boardId: "b1", nodeId: "n1", status: "running" });
    });
    // simulate 30s passing — no fake timers needed, the event is unconditional
    act(() => {
      fn({ type: "handoff", boardId: "b1", fromNodeId: "n1", toNodeId: "n2" });
    });
    const entries = useTimelineStore.getState().getByBoard("b1");
    expect(entries.filter((e) => e.type === "handoff")).toHaveLength(1);
  });

  it("ignores a handoff event missing from/to ids", () => {
    const fn = capture();
    act(() => {
      fn({ type: "handoff", boardId: "b1", fromNodeId: "n1" });
    });
    expect(useTimelineStore.getState().getByBoard("b1")).toHaveLength(0);
  });

  it("records an error when a node reports an error status with a message", () => {
    const fn = capture();
    act(() => {
      fn({
        type: "node_status",
        boardId: "b1",
        nodeId: "n1",
        status: "error",
        message: "boom",
      });
    });
    const entries = useTimelineStore.getState().getByBoard("b1");
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("error");
    expect(entries[0].summary).toContain("boom");
  });

  it("does NOT produce done/inject/turn_end entries — no backend signal exists", () => {
    const fn = capture();
    act(() => {
      fn({ type: "node_status", boardId: "b1", nodeId: "n1", status: "running" });
      fn({ type: "node_status", boardId: "b1", nodeId: "n1", status: "idle" });
      fn({ type: "node_status", boardId: "b1", nodeId: "n1", status: "done" });
      fn({ type: "message_in", boardId: "b1", nodeId: "n1", source: "user", text: "hi" });
      fn({ type: "turn_end", boardId: "b1", nodeId: "n1" });
    });
    expect(useTimelineStore.getState().getByBoard("b1")).toHaveLength(0);
  });

  it("ignores messages scoped to a different board", () => {
    const fn = capture("b1");
    act(() => {
      fn({ type: "handoff", boardId: "other", fromNodeId: "n1", toNodeId: "n2" });
      fn({
        type: "node_status",
        boardId: "other",
        nodeId: "n1",
        status: "error",
        message: "x",
      });
    });
    expect(useTimelineStore.getState().getByBoard("b1")).toHaveLength(0);
  });
});

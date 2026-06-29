import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { TimelinePanel } from "./TimelinePanel";
import { useTimelineStore } from "../stores/timelineStore";

// Regression guard for the "blank app" crash: TimelinePanel's store selector
// must return a STABLE reference for boards with no entries. A fresh `[]` per
// render makes useSyncExternalStore see a new snapshot every time → infinite
// loop → "Maximum update depth exceeded" → React unmounts the whole tree.
// This bites on first open and right after Clear (which deletes the board key).

describe("TimelinePanel", () => {
  beforeEach(() => {
    act(() => {
      useTimelineStore.setState({ entries: {} });
    });
  });

  it("renders the empty state without an infinite render loop", () => {
    const { getByText } = render(<TimelinePanel boardId="board-1" />);
    expect(getByText(/No events yet/i)).toBeTruthy();
  });

  it("survives Clear (board key deleted) without crashing", () => {
    act(() => {
      useTimelineStore.getState().append("board-1", {
        boardId: "board-1",
        type: "handoff",
        nodeId: "n2",
        summary: "a → b",
      });
    });
    const { getByText } = render(<TimelinePanel boardId="board-1" />);
    act(() => {
      useTimelineStore.getState().clear("board-1");
    });
    // Back to the empty state, no "Maximum update depth exceeded" thrown.
    expect(getByText(/No events yet/i)).toBeTruthy();
  });
});

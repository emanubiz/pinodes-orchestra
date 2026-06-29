import { useCallback, useRef } from "react";
import { useTimelineStore } from "../stores/timelineStore";

function nodeLabel(nodeLabels: Record<string, string>, nodeId: string): string {
  return nodeLabels[nodeId] ?? nodeId.slice(0, 8);
}

/**
 * Captures timeline entries from the WS message stream.
 *
 * Handoffs come from the canonical `handoff` event broadcast by the backend's
 * `PtyHub.deliverCall` — the single source of truth for "agent A handed off to
 * agent B". No temporal heuristic, no edge inference: the frontend just records
 * what the backend already knows. Errors are still lifted verbatim from
 * `node_status: error`.
 */
export function useTimelineCapture(
  activeBoardId: string,
  nodeLabels: Record<string, string>,
): (msg: Record<string, unknown>) => void {
  const labelsRef = useRef(nodeLabels);
  const boardRef = useRef(activeBoardId);
  labelsRef.current = nodeLabels;
  boardRef.current = activeBoardId;

  return useCallback((msg: Record<string, unknown>) => {
    const boardId = (msg.boardId as string) || boardRef.current;
    if (boardId !== boardRef.current) return;

    const append = useTimelineStore.getState().append;
    const labels = labelsRef.current;

    if (msg.type === "handoff") {
      const fromNodeId = msg.fromNodeId as string;
      const toNodeId = msg.toNodeId as string;
      if (!fromNodeId || !toNodeId) return;
      append(boardId, {
        boardId,
        type: "handoff",
        nodeId: toNodeId,
        fromNodeId,
        toNodeId,
        summary: `${nodeLabel(labels, fromNodeId)} → ${nodeLabel(labels, toNodeId)}`,
      });
      return;
    }

    if (msg.type === "node_status") {
      const nodeId = msg.nodeId as string;
      const status = msg.status as string;
      if (status === "error" && msg.message) {
        append(boardId, {
          boardId,
          type: "error",
          nodeId,
          summary: `${nodeLabel(labels, nodeId)}: ${msg.message as string}`,
        });
      }
    }
  }, []);
}

/**
 * pi-orchestra · handoff extension
 *
 * Loaded into every node's pi terminal via `-e`. Watches the agent's output and,
 * when it emits a hand-off block, delivers the task to a connected node (an
 * outgoing edge on the canvas) through the orchestrator backend, which injects
 * it into the target node's own pi terminal.
 *
 * Output-parsing (not a custom tool) so it works on ANY provider — including
 * Cursor composer, which does not expose extension tools to the model.
 *
 * The agent hands off by ending its message with:
 *   @@HANDOFF:<targetNodeId>
 *   <task for that agent, can span multiple lines>
 *   @@END
 *
 * Identity + endpoint come from env at spawn time:
 *   PI_ORCHESTRA_URL · PI_ORCHESTRA_BOARD · PI_ORCHESTRA_NODE
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = process.env.PI_ORCHESTRA_URL ?? "http://localhost:3847";
const BOARD_ID = process.env.PI_ORCHESTRA_BOARD ?? "";
const NODE_ID = process.env.PI_ORCHESTRA_NODE ?? "";

const HANDOFF_RE = /@@HANDOFF:\s*([^\s\n]+)\s*\n([\s\S]*?)@@END/g;
const CARD_RE = /@@CARD:\s*([^\s\n]+)/g;

function messageText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text?: string } => Boolean(p) && typeof p === "object")
      .map((p) => (p.type === "text" ? p.text ?? "" : ""))
      .join("");
  }
  return "";
}

export default function handoffExtension(pi: ExtensionAPI) {
  const delivered = new Set<string>();
  const movedTo = new Set<string>();

  pi.on("turn_end", async (event) => {
    const message = (event as { message?: unknown }).message;
    if ((message as { role?: string } | null)?.role !== "assistant") return;

    const text = messageText(message);

    // Kanban card moves (@@CARD:<column>)
    CARD_RE.lastIndex = 0;
    let cardMatch: RegExpExecArray | null;
    while ((cardMatch = CARD_RE.exec(text)) !== null) {
      const column = cardMatch[1].trim().replace(/^["']|["']$/g, "");
      if (!column || movedTo.has(column)) continue;
      movedTo.add(column);
      try {
        await fetch(`${BASE_URL}/internal/card-status`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ boardId: BOARD_ID, column }),
        });
      } catch {
        // backend unreachable
      }
    }

    HANDOFF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HANDOFF_RE.exec(text)) !== null) {
      const targetNodeId = match[1].trim().replace(/^["']|["']$/g, "");
      const taskMessage = match[2].trim();
      if (!targetNodeId || !taskMessage) continue;

      const signature = `${targetNodeId}::${taskMessage}`;
      if (delivered.has(signature)) continue;
      delivered.add(signature);

      try {
        await fetch(`${BASE_URL}/internal/call-agent`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            boardId: BOARD_ID,
            fromNodeId: NODE_ID,
            targetNodeId,
            message: taskMessage,
          }),
        });
      } catch {
        // backend unreachable — nothing else we can do from here
      }
    }
  });
}

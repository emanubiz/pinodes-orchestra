import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Maximize2, Trash2 } from "lucide-react";
import type { WorkflowNodeData, NodeStatus } from "../types";
import { NodeTerminal } from "./NodeTerminal";
import { useTerminalBridge } from "../lib/termTheme";

// Header dot — the precise, canonical status channel.
const statusDot: Record<NodeStatus, string> = {
  idle: "bg-zinc-600",
  running: "bg-emerald-400",
  done: "bg-sky-400",
  error: "bg-red-400",
};

// Left accent bar — the focus/state emphasis (VSCode/Cursor style).
const statusBar: Record<NodeStatus, string> = {
  idle: "bg-transparent",
  running: "bg-emerald-400/80 bar-running",
  done: "bg-sky-400/70",
  error: "bg-red-400/80",
};

function AgentNodeComponent({ id, data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const status = data.status ?? "idle";
  const { onExpand, onDelete } = useTerminalBridge();

  // Selection wins the bar; then live status; an entry node gets a soft amber rest state.
  const bar = selected
    ? "bg-violet-400"
    : status !== "idle"
      ? statusBar[status]
      : data.isEntry
        ? "bg-amber-400/70"
        : "bg-transparent";

  return (
    <div
      className={`relative flex w-[280px] flex-col overflow-hidden rounded-lg border bg-zinc-900 transition-colors duration-150 ${
        selected
          ? "border-zinc-500/60"
          : "border-zinc-700/40 hover:border-zinc-600/60"
      }`}
    >
      {/* left accent bar: focus + state, no card-wide glow */}
      <span className={`absolute left-0 top-0 bottom-0 w-[2px] ${bar}`} />

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !rounded-full !border !border-zinc-700 !bg-zinc-600 hover:!bg-zinc-400"
      />

      {/* header */}
      <div className="flex items-center gap-2 border-b border-zinc-800/80 px-2.5 py-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[status]} ${
            status === "running" ? "live-dot" : ""
          }`}
          title={status === "error" && data.error ? data.error : status}
        />
        <span className="flex-1 truncate text-xs font-medium text-zinc-300">{data.label}</span>
        {data.isEntry && (
          <span
            className="text-[9px] font-medium uppercase tracking-wider text-amber-400/70"
            title="Entry point"
          >
            entry
          </span>
        )}
        <button
          type="button"
          className="nodrag shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          title="Expand terminal"
          onClick={(e) => {
            e.stopPropagation();
            onExpand(id);
          }}
        >
          <Maximize2 size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="nodrag shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
          title="Delete node"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(id);
          }}
        >
          <Trash2 size={12} strokeWidth={2} />
        </button>
      </div>

      {status === "error" && data.error && (
        <div className="px-2.5 py-1 text-[10px] text-red-400 bg-red-950/30 border-b border-red-900/40 truncate" title={data.error}>
          {data.error}
        </div>
      )}

      {/* live mini pi terminal */}
      <div className="h-[150px] bg-[#09090b] px-1 py-0.5">
        <NodeTerminal nodeId={id} />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !rounded-full !border !border-zinc-700 !bg-zinc-600 hover:!bg-zinc-400"
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);

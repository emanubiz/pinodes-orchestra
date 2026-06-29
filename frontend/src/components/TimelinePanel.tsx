import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  TriangleAlert,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTimelineStore } from "../stores/timelineStore";
import type { TimelineEntry, TimelineEventType } from "../types";

interface TimelinePanelProps {
  boardId: string;
  onSelectNode?: (nodeId: string) => void;
}

const TYPE_META: Record<
  TimelineEventType,
  { Icon: LucideIcon; color: string }
> = {
  handoff: { Icon: ArrowRight, color: "#34d399" },
  error: { Icon: TriangleAlert, color: "#f87171" },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Stable empty reference: returning a fresh `[]` from the selector makes
// useSyncExternalStore see a new snapshot every render → infinite loop →
// "Maximum update depth exceeded", which unmounts the whole app. This bites
// whenever the board has no entries (first open, or right after Clear).
const EMPTY: TimelineEntry[] = [];

function selectNodeId(entry: TimelineEntry): string {
  if (entry.type === "handoff" && entry.toNodeId) return entry.toNodeId;
  return entry.nodeId;
}

function isSelectable(type: TimelineEventType): boolean {
  return type === "handoff";
}

export function TimelinePanel({ boardId, onSelectNode }: TimelinePanelProps) {
  const entries = useTimelineStore((s) => s.entries[boardId] ?? EMPTY);
  const clear = useTimelineStore((s) => s.clear);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const prevCountRef = useRef(entries.length);

  const checkPinned = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinnedToBottom(gap <= 100);
  };

  useEffect(() => {
    const grew = entries.length > prevCountRef.current;
    prevCountRef.current = entries.length;
    if (!grew) return;
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedToBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries.length, pinnedToBottom]);

  const scrollToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPinnedToBottom(true);
  };

  return (
    <div className="flex h-full flex-col bg-[var(--app-bg)]">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 shrink-0">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Handoff log
        </span>
        <button
          type="button"
          onClick={() => clear(boardId)}
          className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors"
        >
          Clear
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={checkPinned}
          className="h-full overflow-y-auto px-2 py-2"
        >
          {entries.length === 0 ? (
            <p className="px-1.5 py-6 text-center text-xs text-zinc-500">
              No events yet. Run a flow to see handoffs.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {entries.map((entry) => {
                const meta = TYPE_META[entry.type];
                const { Icon } = meta;
                const clickable = isSelectable(entry.type) && onSelectNode;

                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && onSelectNode(selectNodeId(entry))}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        clickable ? "hover:bg-white/5 cursor-pointer" : "cursor-default"
                      }`}
                    >
                      <span className="mt-0.5 shrink-0" style={{ color: meta.color }}>
                        <Icon size={13} strokeWidth={2} />
                      </span>
                      <span
                        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
                        {formatTime(entry.ts)}
                      </span>
                      <span className="min-w-0 flex-1 text-[11px] text-zinc-300 leading-snug">
                        {entry.summary}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!pinnedToBottom && entries.length > 0 && (
          <button
            type="button"
            onClick={scrollToLatest}
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[10px] text-zinc-300 shadow-lg hover:bg-zinc-800 transition-colors"
          >
            <ChevronDown size={12} />
            Scroll to latest
          </button>
        )}
      </div>
    </div>
  );
}

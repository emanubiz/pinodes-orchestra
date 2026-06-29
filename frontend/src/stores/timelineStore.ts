import { create } from "zustand";
import type { TimelineEntry } from "../types";

const MAX_ENTRIES_PER_BOARD = 200;
const EMPTY: TimelineEntry[] = [];

interface TimelineState {
  entries: Record<string, TimelineEntry[]>;
  append: (boardId: string, entry: Omit<TimelineEntry, "id" | "ts"> & { id?: string; ts?: number }) => void;
  clear: (boardId: string) => void;
  getByBoard: (boardId: string) => TimelineEntry[];
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  entries: {},

  append: (boardId, entry) =>
    set((s) => {
      const prev = s.entries[boardId] ?? [];
      const next: TimelineEntry = {
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
        ts: entry.ts ?? Date.now(),
      };
      const list = [...prev, next];
      if (list.length > MAX_ENTRIES_PER_BOARD) {
        list.splice(0, list.length - MAX_ENTRIES_PER_BOARD);
      }
      return { entries: { ...s.entries, [boardId]: list } };
    }),

  clear: (boardId) =>
    set((s) => {
      const next = { ...s.entries };
      delete next[boardId];
      return { entries: next };
    }),

  getByBoard: (boardId) => get().entries[boardId] ?? EMPTY,
}));

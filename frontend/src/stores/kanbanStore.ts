import { create } from "zustand";
import { persist } from "zustand/middleware";

export type KanbanColumnId = "todo" | "in_progress" | "test" | "review" | "done";

export interface KanbanColumn {
  id: KanbanColumnId;
  label: string;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "test", label: "Test" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

const COLUMN_IDS = new Set(KANBAN_COLUMNS.map((c) => c.id));

/** Map free-form agent text to a column id (e.g. "in progress" → "in_progress"). */
export function normalizeColumn(raw: string): KanbanColumnId | null {
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const alias: Record<string, KanbanColumnId> = {
    todo: "todo",
    to_do: "todo",
    backlog: "todo",
    in_progress: "in_progress",
    inprogress: "in_progress",
    doing: "in_progress",
    wip: "in_progress",
    test: "test",
    testing: "test",
    qa: "test",
    review: "review",
    reviewing: "review",
    done: "done",
    completed: "done",
  };
  if (alias[t]) return alias[t];
  return COLUMN_IDS.has(t as KanbanColumnId) ? (t as KanbanColumnId) : null;
}

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  column: KanbanColumnId;
  linkedBoardId: string | null;
  createdAt: number;
}

interface KanbanState {
  cards: KanbanCard[];
  addCard: (column: KanbanColumnId, title: string) => void;
  updateCard: (id: string, patch: Partial<Omit<KanbanCard, "id">>) => void;
  removeCard: (id: string) => void;
  moveCard: (id: string, column: KanbanColumnId) => void;
  /** Move the card linked to a board (most recent, not yet done) to a column. */
  moveCardByBoard: (boardId: string, column: KanbanColumnId) => void;
}

const OLD_COLUMN_MAP: Record<string, KanbanColumnId> = {
  backlog: "todo",
  todo: "todo",
  doing: "in_progress",
  in_progress: "in_progress",
  test: "test",
  review: "review",
  done: "done",
};

export const useKanbanStore = create<KanbanState>()(
  persist(
    (set) => ({
      cards: [],

      addCard: (column, title) =>
        set((s) => ({
          cards: [
            ...s.cards,
            {
              id: crypto.randomUUID(),
              title: title.trim() || "New card",
              description: "",
              column,
              linkedBoardId: null,
              createdAt: Date.now(),
            },
          ],
        })),

      updateCard: (id, patch) =>
        set((s) => ({
          cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),

      removeCard: (id) =>
        set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),

      moveCard: (id, column) =>
        set((s) => ({
          cards: s.cards.map((c) => (c.id === id ? { ...c, column } : c)),
        })),

      moveCardByBoard: (boardId, column) =>
        set((s) => {
          const candidates = s.cards
            .filter((c) => c.linkedBoardId === boardId && c.column !== "done")
            .sort((a, b) => b.createdAt - a.createdAt);
          const target = candidates[0] ?? s.cards.find((c) => c.linkedBoardId === boardId);
          if (!target) return s;
          return {
            cards: s.cards.map((c) => (c.id === target.id ? { ...c, column } : c)),
          };
        }),
    }),
    {
      name: "pi-orchestra-kanban",
      version: 2,
      migrate: (persisted: unknown) => {
        const state = persisted as { cards?: KanbanCard[] } | undefined;
        if (state?.cards) {
          state.cards = state.cards.map((c) => ({
            ...c,
            column: OLD_COLUMN_MAP[c.column as string] ?? "todo",
          }));
        }
        return state as KanbanState;
      },
    },
  ),
);

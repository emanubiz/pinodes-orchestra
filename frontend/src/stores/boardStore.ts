import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Board, BoardSnapshot } from "../types";

/** Placeholder until /api/info returns the backend default cwd. */
const FALLBACK_CWD = ".";

function emptySnapshot(): BoardSnapshot {
  return { nodes: [], edges: [] };
}

function createBoard(cwd: string, label?: string): Board {
  const name = label ?? cwd.split("/").filter(Boolean).pop() ?? "repo";
  return {
    id: crypto.randomUUID(),
    label: name,
    cwd,
    workflowName: "Untitled",
    workflowId: null,
    entryNodeId: null,
    snapshot: emptySnapshot(),
  };
}

const initialBoard = createBoard(FALLBACK_CWD);

interface BoardState {
  boards: Board[];
  activeBoardId: string;
  defaultCwd: string | null;

  setDefaultCwd: (cwd: string) => void;
  bindWorkspace: (cwd: string, label?: string) => void;
  setActiveBoard: (id: string) => void;
  addBoard: (cwd: string, label?: string) => Board;
  removeBoard: (id: string) => void;
  updateActiveBoard: (patch: Partial<Omit<Board, "id">>) => void;
  updateBoardSnapshot: (boardId: string, snapshot: BoardSnapshot) => void;
}

export const useBoardStore = create<BoardState>()(
  persist(
    (set, get) => ({
      boards: [initialBoard],
      activeBoardId: initialBoard.id,
      defaultCwd: null,

      setDefaultCwd: (cwd) => {
        set({ defaultCwd: cwd });
        // Upgrade the placeholder board created before /api/info arrived.
        const { boards } = get();
        if (boards.length === 1 && boards[0].cwd === FALLBACK_CWD) {
          const upgraded = { ...boards[0], cwd, label: boards[0].label === "repo" ? cwd.split("/").filter(Boolean).pop() ?? "repo" : boards[0].label };
          set({ boards: [upgraded] });
        }
      },

      // Embedded hosts (VS Code) own the project: collapse to a single board
      // bound to the host cwd, reusing a persisted board for that cwd so the
      // graph survives a panel reopen.
      bindWorkspace: (cwd, label) => {
        const { boards } = get();
        const existing = boards.find((b) => b.cwd === cwd);
        const board = existing ?? createBoard(cwd, label);
        set({ boards: [board], activeBoardId: board.id, defaultCwd: cwd });
      },

      setActiveBoard: (id) => set({ activeBoardId: id }),

      addBoard: (cwd, label) => {
        const board = createBoard(cwd, label);
        set((s) => ({
          boards: [...s.boards, board],
          activeBoardId: board.id,
        }));
        return board;
      },

      removeBoard: (id) =>
        set((s) => {
          if (s.boards.length <= 1) return s;
          const boards = s.boards.filter((b) => b.id !== id);
          const activeBoardId =
            s.activeBoardId === id ? boards[0]?.id ?? "" : s.activeBoardId;
          return { boards, activeBoardId };
        }),

      updateActiveBoard: (patch) =>
        set((s) => ({
          boards: s.boards.map((b) =>
            b.id === s.activeBoardId ? { ...b, ...patch } : b,
          ),
        })),

      updateBoardSnapshot: (boardId, snapshot) =>
        set((s) => ({
          boards: s.boards.map((b) => (b.id === boardId ? { ...b, snapshot } : b)),
        })),
    }),
    {
      name: "pi-orchestra-boards",
      partialize: (s) => ({ boards: s.boards, activeBoardId: s.activeBoardId }),
      onRehydrateStorage: () => (state) => {
        if (state && !state.activeBoardId && state.boards[0]) {
          state.activeBoardId = state.boards[0].id;
        }
      },
    },
  ),
);

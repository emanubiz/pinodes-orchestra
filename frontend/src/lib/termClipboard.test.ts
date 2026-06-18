import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachClipboard } from "./termClipboard";

function mockTerminal(): Terminal & {
  keyHandler: ((e: KeyboardEvent) => boolean) | null;
  pasted: string[];
} {
  const state = {
    selection: "",
    keyHandler: null as ((e: KeyboardEvent) => boolean) | null,
    pasted: [] as string[],
  };
  return {
    get keyHandler() {
      return state.keyHandler;
    },
    get pasted() {
      return state.pasted;
    },
    getSelection: () => state.selection,
    hasSelection: () => state.selection.length > 0,
    paste: (text: string) => {
      state.pasted.push(text);
    },
    attachCustomKeyEventHandler: (fn: (e: KeyboardEvent) => boolean) => {
      state.keyHandler = fn;
    },
  } as unknown as Terminal & { keyHandler: ((e: KeyboardEvent) => boolean) | null; pasted: string[] };
}

describe("attachClipboard", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn(async () => "clip-text"),
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
  });

  it("copies selection on Ctrl+Shift+C", async () => {
    const term = mockTerminal();
    term.getSelection = () => "hello";
    attachClipboard(term, host);

    const handled = term.keyHandler!({
      type: "keydown",
      key: "c",
      ctrlKey: true,
      shiftKey: true,
    } as KeyboardEvent);

    expect(handled).toBe(false);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
  });

  it("pastes on Ctrl+Shift+V", async () => {
    const term = mockTerminal();
    attachClipboard(term, host);

    const handled = term.keyHandler!({
      type: "keydown",
      key: "v",
      ctrlKey: true,
      shiftKey: true,
    } as KeyboardEvent);

    expect(handled).toBe(false);
    await vi.waitFor(() => expect(term.pasted).toEqual(["clip-text"]));
  });

  it("pastes on Shift+Insert (Linux convention)", async () => {
    const term = mockTerminal();
    attachClipboard(term, host);

    term.keyHandler!({
      type: "keydown",
      key: "Insert",
      shiftKey: true,
    } as KeyboardEvent);

    await vi.waitFor(() => expect(term.pasted).toEqual(["clip-text"]));
  });
});

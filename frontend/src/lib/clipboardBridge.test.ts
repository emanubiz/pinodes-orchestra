import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("clipboardBridge (embedded)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("location", { search: "?embed=vscode&cwd=/tmp" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves read via host postMessage round-trip", async () => {
    const post = vi.spyOn(window.parent as Window, "postMessage");
    const { initClipboardBridge, readClipboardViaHost } = await import("./clipboardBridge");
    initClipboardBridge();

    const readPromise = readClipboardViaHost();

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "orchestra-clipboard", action: "read" }),
      "*",
    );

    const id = (post.mock.calls[0][0] as { id: number }).id;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "orchestra-clipboard-result", id, text: "from-host" },
      }),
    );

    await expect(readPromise).resolves.toBe("from-host");
  });
});

import { IS_EMBEDDED } from "./embed";

/** Pending clipboard requests keyed by id. */
const pending = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>();
let nextId = 0;

export interface ClipboardResultMessage {
  type: "orchestra-clipboard-result";
  id: number;
  text?: string;
  error?: string;
}

/** Wire the iframe-side listener for host-mediated clipboard ops (VS Code webview). */
export function initClipboardBridge(): void {
  if (!IS_EMBEDDED) return;

  window.addEventListener("message", (ev: MessageEvent) => {
    const msg = ev.data as ClipboardResultMessage | undefined;
    if (!msg || msg.type !== "orchestra-clipboard-result") return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.text ?? "");
  });
}

function postToHost(action: "read" | "write", text?: string): Promise<string> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      window.parent?.postMessage({ type: "orchestra-clipboard", action, id, text }, "*");
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error("clipboard bridge timeout"));
    }, 8000);
  });
}

/** Read clipboard text via the host webview (works inside cross-origin iframes). */
export async function readClipboardViaHost(): Promise<string> {
  if (!IS_EMBEDDED) throw new Error("not embedded");
  return postToHost("read");
}

/** Write clipboard text via the host webview. */
export async function writeClipboardViaHost(text: string): Promise<void> {
  if (!IS_EMBEDDED) throw new Error("not embedded");
  await postToHost("write", text);
}

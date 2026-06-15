import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { onPtyOutput } from "../lib/ptyBus";
import { TERM_FONT, TERM_THEME, useTerminalBridge } from "../lib/termTheme";
import { useRuntimeStore } from "../stores/runtimeStore";

/** Live, read-only mini view of a node's pi terminal, embedded in its card. */
export function NodeTerminal({ nodeId }: { nodeId: string }) {
  const { boardId, send } = useTerminalBridge();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [live, setLive] = useState(false);
  const connected = useRuntimeStore((s) => s.connected);

  // 1. Mount terminal and wire PTY output.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const key = `${boardId}:${nodeId}`;

    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      fontSize: 11,
      lineHeight: 1.15,
      fontFamily: TERM_FONT,
      theme: TERM_THEME,
      scrollback: 800,
      convertEol: false,
      minimumContrastRatio: 1,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    const unsub = onPtyOutput(key, (data, replay) => {
      if (replay) term.reset();
      if (data.length > 0) setLive(true);
      term.write(data);
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        send({ type: "pty_resize", nodeId, cols: term.cols, rows: term.rows });
      } catch {
        /* mid-teardown */
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      unsub();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [boardId, nodeId, send]);

  // 2. Attach to the backend only once the WebSocket is actually open.
  useEffect(() => {
    if (!connected) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
    } catch {
      /* not measured yet */
    }
    send({ type: "attach_node", nodeId, cols: term.cols, rows: term.rows });
  }, [connected, nodeId, send]);

  // pointer-events off so dragging/clicking the node still works through it.
  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" style={{ pointerEvents: "none" }} />
      {!live && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600">
          avvio pi...
        </div>
      )}
    </div>
  );
}

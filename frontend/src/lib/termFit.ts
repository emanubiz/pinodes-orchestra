import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/**
 * Fit an xterm instance into its host element and notify when it has a valid
 * size. Retries on requestAnimationFrame if the host has not been laid out yet
 * (e.g. a sidebar that just opened). Also observes host resizes and notifies
 * only when columns or rows actually change.
 */
export function fitWhenReady(
  term: Terminal,
  fit: FitAddon,
  host: HTMLElement,
  onSize: (cols: number, rows: number) => void,
  opts: { maxAttempts?: number } = {},
): () => void {
  let attempts = 0;
  const maxAttempts = opts.maxAttempts ?? 60;

  function tryFit() {
    attempts++;
    try {
      fit.fit();
    } catch {
      // host may not be measurable yet
    }
    if (
      term.cols > 0 &&
      term.rows > 0 &&
      host.clientWidth > 0 &&
      host.clientHeight > 0
    ) {
      onSize(term.cols, term.rows);
      return;
    }
    if (attempts < maxAttempts) {
      requestAnimationFrame(tryFit);
    }
  }

  tryFit();

  const ro = new ResizeObserver(() => {
    const prevCols = term.cols;
    const prevRows = term.rows;
    try {
      fit.fit();
    } catch {
      return;
    }
    if (
      (term.cols !== prevCols || term.rows !== prevRows) &&
      term.cols > 0 &&
      term.rows > 0
    ) {
      onSize(term.cols, term.rows);
    }
  });
  ro.observe(host);

  return () => ro.disconnect();
}

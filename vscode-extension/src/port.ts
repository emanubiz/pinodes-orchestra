import * as net from "node:net";

/** True when `port` on 127.0.0.1 can be bound (cross-platform). */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

/** First free port on 127.0.0.1 starting at `start` (cross-platform). */
export async function findFreePort(start: number, attempts = 64): Promise<number> {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port in [${start}, ${start + attempts})`);
}

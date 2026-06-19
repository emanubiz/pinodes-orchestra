import * as net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { findFreePort, isPortFree } from "./port.js";

describe("isPortFree", () => {
  it("returns false when the port is already bound", async () => {
    const srv = net.createServer();
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const port = (srv.address() as net.AddressInfo).port;
    expect(await isPortFree(port)).toBe(false);
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });

  it("returns true for an unbound port", async () => {
    const srv = net.createServer();
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    const port = (srv.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    expect(await isPortFree(port)).toBe(true);
  });
});

describe("findFreePort", () => {
  let holder: net.Server | undefined;

  afterEach(async () => {
    if (!holder) return;
    await new Promise<void>((resolve) => holder!.close(() => resolve()));
    holder = undefined;
  });

  it("returns the start port when it is free", async () => {
    const port = await findFreePort(39_000, 8);
    expect(port).toBe(39_000);
  });

  it("returns start+1 when start is occupied", async () => {
    holder = net.createServer();
    await new Promise<void>((resolve) => holder!.listen(39_010, "127.0.0.1", resolve));
    const port = await findFreePort(39_010, 8);
    expect(port).toBe(39_011);
  });

  it("throws when no port is free in the range", async () => {
    await expect(findFreePort(39_020, 0)).rejects.toThrow(/No free port/);
  });
});

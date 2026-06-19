import { describe, it, expect } from "vitest";
import { resolveBaseForLocation } from "./api";

describe("resolveBaseForLocation", () => {
  it('returns "" for port 3848 (dynamic backend port)', () => {
    expect(
      resolveBaseForLocation(
        { protocol: "http:", hostname: "127.0.0.1", port: "3848" },
        { dev: false },
      ),
    ).toBe("");
  });

  it('returns "" for port 3847 (no regression)', () => {
    expect(
      resolveBaseForLocation(
        { protocol: "http:", hostname: "127.0.0.1", port: "3847" },
        { dev: false },
      ),
    ).toBe("");
  });

  it("falls back to localhost:3847 when port is empty", () => {
    expect(
      resolveBaseForLocation({ protocol: "file:", hostname: "", port: "" }, { dev: false }),
    ).toBe("http://localhost:3847");
  });

  it('returns "" in Vite dev mode regardless of port', () => {
    expect(
      resolveBaseForLocation(
        { protocol: "http:", hostname: "localhost", port: "5173" },
        { dev: true },
      ),
    ).toBe("");
  });
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { workspaceInstanceDataDir } from "./workspaceDataDir.js";

describe("workspaceInstanceDataDir", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pinodes-data-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("returns the same path for the same workspace key", () => {
    const root = tempRoot();
    const a = workspaceInstanceDataDir(root, "/repo/a");
    const b = workspaceInstanceDataDir(root, "/repo/a");
    expect(a).toBe(b);
    expect(fs.existsSync(a)).toBe(true);
  });

  it("returns different paths for different workspace keys", () => {
    const root = tempRoot();
    const a = workspaceInstanceDataDir(root, "/repo/a");
    const b = workspaceInstanceDataDir(root, "/repo/b");
    expect(a).not.toBe(b);
  });

  it("places instances under globalStorage/instances/<hash>", () => {
    const root = tempRoot();
    const dir = workspaceInstanceDataDir(root, "default");
    expect(dir.startsWith(path.join(root, "instances"))).toBe(true);
  });
});

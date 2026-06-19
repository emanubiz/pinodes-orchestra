import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Per-workspace SQLite directory under extension global storage. */
export function workspaceInstanceDataDir(globalStoragePath: string, workspaceKey: string): string {
  const hash = crypto.createHash("sha256").update(workspaceKey).digest("hex").slice(0, 16);
  const dir = path.join(globalStoragePath, "instances", hash);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

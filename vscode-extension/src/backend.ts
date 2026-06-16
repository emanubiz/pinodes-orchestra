import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export type BackendStatus = "stopped" | "starting" | "running" | "external" | "error";

/**
 * Owns the pi-orchestra backend lifecycle for the extension.
 *
 * Strategy (per docs/EXTENSIONS_ROADMAP.md, Phase 2): never run node-pty /
 * better-sqlite3 in-process inside the extension host. Instead spawn the
 * existing Fastify backend (`backend/dist/index.js`) as a Node subprocess and
 * talk to it over localhost HTTP/WS, exactly like the standalone app.
 */
export class BackendManager {
  private proc: ChildProcess | undefined;
  private external = false;
  private _status: BackendStatus = "stopped";
  private readonly output: vscode.OutputChannel;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<BackendStatus>();

  /** Fires whenever the backend status changes (drives the control view). */
  readonly onDidChangeStatus = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("Pi Orchestra");
    context.subscriptions.push(this.output, this.onDidChangeEmitter);
  }

  get status(): BackendStatus {
    return this._status;
  }

  get port(): number {
    return vscode.workspace.getConfiguration("piOrchestra").get<number>("port", 3847);
  }

  get baseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  showLogs(): void {
    this.output.show(true);
  }

  private setStatus(status: BackendStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.onDidChangeEmitter.fire(status);
  }

  /**
   * Ensure a backend is reachable. If one already answers /api/health we adopt
   * it (e.g. the user runs `npm run dev`); otherwise we spawn our own.
   */
  async ensureStarted(): Promise<void> {
    if (this._status === "running" || this._status === "external") {
      if (await this.isHealthy()) return;
    }

    if (await this.isHealthy()) {
      this.external = true;
      this.log(`Adopted backend already running on ${this.baseUrl}`);
      this.setStatus("external");
      return;
    }

    await this.spawnBackend();
  }

  private resolveEntry(): string {
    const configured = vscode.workspace
      .getConfiguration("piOrchestra")
      .get<string>("backendEntry", "")
      .trim();
    if (configured) return configured;

    // Default layout: <repo>/vscode-extension/  →  <repo>/backend/dist/index.js
    return path.join(this.context.extensionPath, "..", "backend", "dist", "index.js");
  }

  private workspaceCwd(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private async spawnBackend(): Promise<void> {
    const entry = this.resolveEntry();
    if (!fs.existsSync(entry)) {
      this.setStatus("error");
      const msg = `Backend entry not found: ${entry}. Build it with \`npm run build\` in the pi-orchestra repo, or set "piOrchestra.backendEntry".`;
      this.log(msg);
      throw new Error(msg);
    }

    const nodeCmd = vscode.workspace
      .getConfiguration("piOrchestra")
      .get<string>("nodeCommand", "node");
    const cwd = this.workspaceCwd() ?? path.dirname(path.dirname(entry));

    this.setStatus("starting");
    this.log(`Starting backend: ${nodeCmd} ${entry}`);
    this.log(`  cwd:  ${cwd}`);
    this.log(`  port: ${this.port}`);

    this.proc = spawn(nodeCmd, [entry], {
      cwd,
      env: { ...process.env, PORT: String(this.port) },
    });
    this.external = false;

    this.proc.stdout?.on("data", (d: Buffer) => this.output.append(d.toString()));
    this.proc.stderr?.on("data", (d: Buffer) => this.output.append(d.toString()));
    this.proc.on("exit", (code, signal) => {
      this.log(`Backend exited (code=${code}, signal=${signal})`);
      this.proc = undefined;
      this.setStatus("stopped");
    });
    this.proc.on("error", (err) => {
      this.log(`Failed to start backend: ${err.message}`);
      this.proc = undefined;
      this.setStatus("error");
    });

    await this.waitForHealth();
  }

  private async waitForHealth(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this._status === "stopped" || this._status === "error") {
        throw new Error("Backend process exited before becoming healthy. See Pi Orchestra logs.");
      }
      if (await this.isHealthy()) {
        this.log(`Backend healthy on ${this.baseUrl}`);
        this.setStatus("running");
        return;
      }
      await delay(400);
    }
    this.setStatus("error");
    throw new Error(`Backend did not become healthy within ${timeoutMs / 1000}s. See Pi Orchestra logs.`);
  }

  async isHealthy(): Promise<boolean> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: controller.signal });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean; name?: string };
      return body.ok === true && body.name === "pi-orchestra";
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.ensureStarted();
  }

  async stop(): Promise<void> {
    if (this.external) {
      this.log("Backend is externally owned; not stopping it.");
      this.external = false;
      this.setStatus("stopped");
      return;
    }
    const proc = this.proc;
    if (!proc) {
      this.setStatus("stopped");
      return;
    }
    this.log("Stopping backend…");
    await new Promise<void>((resolve) => {
      const onExit = () => resolve();
      proc.once("exit", onExit);
      proc.kill();
      // Hard kill if it lingers.
      setTimeout(() => {
        if (this.proc === proc) proc.kill("SIGKILL");
        resolve();
      }, 3000);
    });
    this.proc = undefined;
    this.setStatus("stopped");
  }

  private log(line: string): void {
    this.output.appendLine(`[pi-orchestra] ${line}`);
  }

  dispose(): void {
    void this.stop();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

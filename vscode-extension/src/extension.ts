import * as vscode from "vscode";
import { BackendManager, PiNotFoundError } from "./backend";
import { ControlViewProvider } from "./controlView";
import { OrchestraPanel } from "./panel";

let backendManager: BackendManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const backend = new BackendManager(context);
  backendManager = backend;
  context.subscriptions.push(backend);

  const control = new ControlViewProvider(backend);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ControlViewProvider.viewType, control),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("pinodesOrchestra.open", async () => {
      try {
        await OrchestraPanel.show(context, backend);
      } catch (err) {
        // pi-missing already showed its own actionable modal — don't double up.
        if (err instanceof PiNotFoundError) return;
        const msg = err instanceof Error ? err.message : String(err);
        const pick = await vscode.window.showErrorMessage(
          `PiNodes Orchestra: ${msg}`,
          "Show Logs",
        );
        if (pick === "Show Logs") backend.showLogs();
      }
    }),
    vscode.commands.registerCommand("pinodesOrchestra.restartBackend", async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Restarting PiNodes Orchestra backend…" },
          () => backend.restart(),
        );
      } catch (err) {
        if (err instanceof PiNotFoundError) return;
        throw err;
      }
    }),
    vscode.commands.registerCommand("pinodesOrchestra.stopBackend", () => backend.stop()),
    vscode.commands.registerCommand("pinodesOrchestra.showLogs", () => backend.showLogs()),
  );
}

export async function deactivate(): Promise<void> {
  // On window close / extension shutdown, stop the spawned backend explicitly
  // (subscription disposal also covers this, but awaiting here makes the kill
  // deterministic). The backend's own parent-PID watchdog is the final fallback.
  await backendManager?.stop();
  backendManager = undefined;
}

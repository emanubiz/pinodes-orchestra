import * as vscode from "vscode";
import { BackendManager } from "./backend";
import { ControlViewProvider } from "./controlView";
import { OrchestraPanel } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  const backend = new BackendManager(context);
  context.subscriptions.push(backend);

  const control = new ControlViewProvider(backend);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ControlViewProvider.viewType, control),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("piOrchestra.open", async () => {
      try {
        await OrchestraPanel.show(context, backend);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const pick = await vscode.window.showErrorMessage(
          `Pi Orchestra: ${msg}`,
          "Show Logs",
        );
        if (pick === "Show Logs") backend.showLogs();
      }
    }),
    vscode.commands.registerCommand("piOrchestra.restartBackend", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Restarting Pi Orchestra backend…" },
        () => backend.restart(),
      );
    }),
    vscode.commands.registerCommand("piOrchestra.stopBackend", () => backend.stop()),
    vscode.commands.registerCommand("piOrchestra.showLogs", () => backend.showLogs()),
  );
}

export function deactivate(): Thenable<void> | undefined {
  // Subscriptions (incl. BackendManager) are disposed by VS Code, which stops
  // any backend we spawned.
  return undefined;
}

import * as vscode from "vscode";
import { BackendManager, BackendStatus } from "./backend";

/** Lightweight launcher/status view rendered in the PiNodes Orchestra activity-bar container. */
export class ControlViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "pinodesOrchestra.control";
  private view: vscode.WebviewView | undefined;

  constructor(private readonly backend: BackendManager) {
    backend.onDidChangeStatus((s) => this.update(s));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((msg: { type?: string }) => {
      switch (msg?.type) {
        case "open":
          void vscode.commands.executeCommand("pinodesOrchestra.open");
          break;
        case "restart":
          void vscode.commands.executeCommand("pinodesOrchestra.restartBackend");
          break;
        case "stop":
          void vscode.commands.executeCommand("pinodesOrchestra.stopBackend");
          break;
        case "logs":
          void vscode.commands.executeCommand("pinodesOrchestra.showLogs");
          break;
      }
    });
    this.update(this.backend.status);
  }

  private update(status: BackendStatus): void {
    if (!this.view) return;
    this.view.webview.html = html(status, this.backend.port);
  }
}

function html(status: BackendStatus, port: number): string {
  const label: Record<BackendStatus, string> = {
    stopped: "Stopped",
    starting: "Starting…",
    running: "Running",
    error: "Error",
  };
  const color: Record<BackendStatus, string> = {
    stopped: "#71717a",
    starting: "#fbbf24",
    running: "#34d399",
    error: "#f87171",
  };
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
    .status { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 13px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: ${color[status]}; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 11px; }
    button {
      display: block; width: 100%; margin: 6px 0; padding: 6px 10px; cursor: pointer;
      text-align: left; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px;
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button:hover { filter: brightness(1.1); }
  </style>
</head>
<body>
  <div class="status"><span class="dot"></span><span>${label[status]}</span></div>
  <p class="muted">Backend → localhost:${port}</p>
  <button class="primary" onclick="send('open')">Open PiNodes Orchestra</button>
  <button onclick="send('restart')">Restart backend</button>
  <button onclick="send('stop')">Stop backend</button>
  <button onclick="send('logs')">Show logs</button>
  <script>
    const vscode = acquireVsCodeApi();
    function send(type) { vscode.postMessage({ type }); }
  </script>
</body>
</html>`;
}

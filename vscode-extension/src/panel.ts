import * as vscode from "vscode";
import { BackendManager } from "./backend";

/**
 * Full editor-area webview that embeds the standalone pi-orchestra UI in an
 * iframe pointing at the local backend. The backend already serves the built
 * frontend (React Flow + xterm) on `/`, so we just need to frame it; live PTY
 * WebSockets run inside the iframe against its own (backend) origin.
 */
export class OrchestraPanel {
  private static current: OrchestraPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static async show(context: vscode.ExtensionContext, backend: BackendManager): Promise<void> {
    if (OrchestraPanel.current) {
      OrchestraPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const autoStart = vscode.workspace
      .getConfiguration("piOrchestra")
      .get<boolean>("autoStartBackend", true);
    if (autoStart) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Starting Pi Orchestra backend…" },
        () => backend.ensureStarted(),
      );
    }

    const panel = vscode.window.createWebviewPanel(
      "piOrchestra.panel",
      "Pi Orchestra",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    OrchestraPanel.current = new OrchestraPanel(panel, backend);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly backend: BackendManager) {
    this.panel = panel;
    void this.render();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: { type?: string }) => {
        if (msg?.type === "reload") void this.render();
      },
      null,
      this.disposables,
    );
  }

  private async render(): Promise<void> {
    const external = await vscode.env.asExternalUri(vscode.Uri.parse(this.backend.baseUrl));
    // Embedded mode: bind the single board to the VS Code workspace folder and
    // hide the standalone repo-tab switcher (see frontend/src/lib/embed.ts).
    const url = new URL(external.toString());
    url.searchParams.set("embed", "vscode");
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) url.searchParams.set("cwd", folder);
    this.panel.webview.html = renderHtml(this.panel.webview, url.toString());
  }

  dispose(): void {
    OrchestraPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

function renderHtml(webview: vscode.Webview, src: string): string {
  // The iframe loads the backend origin; allow framing http/https + ws for it.
  const csp = [
    "default-src 'none'",
    "frame-src http: https:",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
  ].join("; ");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body { height: 100%; margin: 0; padding: 0; background: #09090b; }
    iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    #fallback {
      position: absolute; inset: 0; display: none; place-content: center;
      color: #a1a1aa; font-family: var(--vscode-font-family); text-align: center; padding: 2rem;
    }
    #fallback button {
      margin-top: 1rem; padding: 6px 14px; cursor: pointer;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 4px;
    }
  </style>
</head>
<body>
  <iframe id="app" src="${src}" allow="clipboard-read; clipboard-write"></iframe>
  <div id="fallback">
    <div>
      <p>Pi Orchestra backend is not reachable.</p>
      <button onclick="reload()">Retry</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('app');
    const fallback = document.getElementById('fallback');
    function reload() { vscode.postMessage({ type: 'reload' }); }
    frame.addEventListener('error', () => { fallback.style.display = 'grid'; });
  </script>
</body>
</html>`;
}

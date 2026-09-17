"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { startService, bundledExecutable } = require("./host.cjs");
let panel, backend, opening, shuttingDown;
let startupAbort, starting, explorer;
const navigation = require("./static/navigation-model.js");
const { WorkspaceExplorer } = require("./explorer.cjs");
async function ensureBackend(context) {
  if (backend) return backend;
  if (starting) return starting;
  startupAbort = new AbortController();
  starting = (async () => {
    await shuttingDown;
    backend = await startService({
      signal: startupAbort.signal,
      executable: bundledExecutable(context.extensionPath),
      stateDir: path.join(context.globalStorageUri.fsPath, "workspace"),
      onExit: (error) => {
        backend = undefined;
        explorer?.reset(true);
        vscode.window.showErrorMessage(error.message);
        panel?.dispose();
      },
    });
    return backend;
  })();
  try {
    return await starting;
  } finally {
    starting = undefined;
  }
}
let navigatePanel;
const routes = new Set([
  "overview",
  "tables",
  "imports",
  "settings",
  "activity",
]);
async function openAt(context, route, connectionId) {
  if (!navigation.validRoute(route)) return;
  await open(context);
  navigatePanel?.(route, connectionId);
}
async function stop() {
  startupAbort?.abort();
  if (starting) await starting.catch(() => {});
  if (opening) await opening.catch(() => {});
  const old = panel,
    running = backend;
  panel = undefined;
  backend = undefined;
  navigatePanel = undefined;
  old?.dispose();
  explorer?.reset(true);
  if (running) shuttingDown = running.stop();
  await shuttingDown;
}
async function open(context) {
  if (opening) return opening;
  if (panel) {
    panel.reveal();
    return;
  }
  opening = (async () => {
    try {
      await ensureBackend(context);
      const owned = backend;
      panel = vscode.window.createWebviewPanel(
        "dynamodbTools",
        "DynamoDB Tools",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(path.join(context.extensionPath, "static")),
          ],
        },
      );
      const current = panel;
      let ready = false,
        queuedRoute;
      navigatePanel = (route, connectionId) => {
        if (!navigation.validRoute(route) || panel !== current) return;
        queuedRoute = { route, connectionId };
        if (ready) {
          current.webview.postMessage({
            kind: "navigate",
            route,
            connectionId,
          });
          queuedRoute = undefined;
        }
      };
      const nonce = crypto.randomBytes(24).toString("base64");
      let html = fs.readFileSync(
        path.join(context.extensionPath, "static/index.html"),
        "utf8",
      );
      html = html.replace(
        "</head>",
        '<link rel="stylesheet" href="/static/vscode-theme.css"></head>',
      );
      html = html.replaceAll(
        /(?:src|href)="\/static\/([^"?]+)"/g,
        (match, file) =>
          match.replace(
            "/static/" + file,
            current.webview
              .asWebviewUri(
                vscode.Uri.file(
                  path.join(context.extensionPath, "static", file),
                ),
              )
              .toString(),
          ),
      );
      html = html.replaceAll("<script ", `<script nonce="${nonce}" `);
      const bridge = current.webview.asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, "static/bridge.js")),
      );
      html = html.replace(
        "<head>",
        `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${current.webview.cspSource} data:; style-src ${current.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none'; font-src ${current.webview.cspSource}; base-uri 'none'; form-action 'none';"><script nonce="${nonce}" src="${bridge}"></script>`,
      );
      current.webview.html = html;
      current.webview.onDidReceiveMessage(async (message) => {
        if (panel !== current || !message) return;
        if (message.kind === "ready") {
          ready = true;
          if (queuedRoute)
            navigatePanel?.(queuedRoute.route, queuedRoute.connectionId);
          return;
        }
        if (message.kind === "navigationBlocked") {
          vscode.window.showInformationMessage(
            "Close the current DynamoDB Tools dialog before navigating. Your draft is still open.",
          );
          return;
        }
        if (
          panel !== current ||
          !message ||
          !Number.isSafeInteger(message.id) ||
          message.id < 1
        )
          return;
        try {
          let result;
          if (message.kind === "request") {
            result = await owned.request(message);
            await explorer?.accept(message, result);
          } else if (message.kind === "download") {
            if (
              typeof message.text !== "string" ||
              Buffer.byteLength(message.text) > 64 * 1024 * 1024
            )
              throw new Error("Export exceeds 64 MiB");
            const filename =
              path
                .basename(String(message.filename))
                .replace(/[^a-zA-Z0-9_.-]/g, "_")
                .slice(0, 120) || "export.json";
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(
                path.join(require("node:os").homedir(), filename),
              ),
              filters: { JSON: ["json"] },
            });
            if (!uri) throw new Error("Export cancelled");
            await vscode.workspace.fs.writeFile(
              uri,
              Buffer.from(message.text, "utf8"),
            );
            result = true;
          } else if (message.kind === "copy") {
            if (
              typeof message.text !== "string" ||
              Buffer.byteLength(message.text) > 8 * 1024 * 1024
            )
              throw new Error("Clipboard text exceeds 8 MiB");
            await vscode.env.clipboard.writeText(message.text);
            result = true;
          } else throw new Error("Unsupported console message");
          await current.webview.postMessage({ id: message.id, result });
        } catch (error) {
          await current.webview.postMessage({
            id: message.id,
            error: error.message,
          });
        }
      });
      current.onDidDispose(() => {
        if (panel === current) {
          panel = undefined;
          navigatePanel = undefined;
        }
        // The explorer owns the service even when its editor is closed.
      });
    } catch (error) {
      await vscode.window.showErrorMessage("DynamoDB Tools: " + error.message);
      throw error;
    }
  })();
  try {
    await opening;
  } finally {
    opening = undefined;
  }
}
function activate(context) {
  explorer = new WorkspaceExplorer(
    async (message) => (await ensureBackend(context)).request(message),
    (route, connectionId) => openAt(context, route, connectionId),
    (definitions) =>
      panel?.webview.postMessage({ kind: "definitions", definitions }),
  );
  context.subscriptions.push(
    explorer,
    vscode.window.registerTreeDataProvider("dynamodbTools.workspace", explorer),
    vscode.commands.registerCommand(
      "dynamodbTools.navigate",
      (route, connectionId) => openAt(context, route, connectionId),
    ),
    vscode.commands.registerCommand("dynamodbTools.refreshExplorer", () =>
      explorer.reset(),
    ),
    vscode.commands.registerCommand("dynamodbTools.favourite", (node) =>
      explorer
        .toggleFavourite(node)
        .catch((error) => vscode.window.showErrorMessage(error.message)),
    ),
    vscode.commands.registerCommand("dynamodbTools.open", () => open(context)),
    ...[...routes].map((route) =>
      vscode.commands.registerCommand("dynamodbTools." + route, () =>
        openAt(context, route),
      ),
    ),
    vscode.commands.registerCommand("dynamodbTools.restart", async () => {
      await stop();
      await shuttingDown;
      return open(context);
    }),
    vscode.commands.registerCommand("dynamodbTools.stop", stop),
  );
}
async function deactivate() {
  await stop();
  await shuttingDown;
}
module.exports = { activate, deactivate };

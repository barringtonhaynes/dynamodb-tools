"use strict";
const { app, BrowserWindow, dialog, Menu } = require("electron");
const path = require("node:path");
const { startService, bundledExecutable } = require("../shared/service.cjs");
const customData = app.commandLine.getSwitchValue("user-data-dir");
if (customData) app.setPath("userData", path.resolve(customData));
let backend,
  window,
  quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    try {
      backend = await startService({
        executable: bundledExecutable(
          app.isPackaged
            ? process.resourcesPath
            : path.join(__dirname, "../../build/runtime"),
        ),
        stateDir: path.join(app.getPath("userData"), "workspace"),
        onExit: (error) => {
          dialog.showErrorBox("DynamoDB Tools stopped", error.message);
          app.quit();
        },
      });
      window = new BrowserWindow({
        width: 1320,
        height: 900,
        minWidth: 680,
        minHeight: 540,
        title: "DynamoDB Tools",
        backgroundColor: "#f7f7fa",
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      const session = window.webContents.session;
      session.setPermissionRequestHandler(
        (_webContents, _permission, callback) =>
          callback(
            _permission === "clipboard-sanitized-write" &&
              _webContents?.getURL().startsWith(backend.url + "/"),
          ),
      );
      session.setPermissionCheckHandler(
        (contents, permission) =>
          permission === "clipboard-sanitized-write" &&
          contents?.getURL().startsWith(backend.url + "/"),
      );
      session.webRequest.onBeforeSendHeaders(
        { urls: [backend.url + "/*"] },
        (details, callback) => {
          callback({
            requestHeaders: {
              ...details.requestHeaders,
              Authorization: `Bearer ${backend.token}`,
            },
          });
        },
      );
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== backend.url) event.preventDefault();
      });
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.on("ready-to-show", () => window.show());
      const menus = [
        ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
        { role: "fileMenu" },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Workspace",
          submenu: [
            {
              label: "Connection settings",
              click: () => window.loadURL(backend.url + "/#settings"),
            },
          ],
        },
      ];
      Menu.setApplicationMenu(Menu.buildFromTemplate(menus));
      await window.loadURL(backend.url + "/#settings");
    } catch (error) {
      dialog.showErrorBox("Could not open DynamoDB Tools", error.message);
      app.quit();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (!backend || quitting) return;
    event.preventDefault();
    quitting = true;
    backend.stop().finally(() => app.quit());
  });
}

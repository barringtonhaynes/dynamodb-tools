(() => {
  const vscode = acquireVsCodeApi();
  let sequence = 0;
  const pending = new Map();
  function call(message) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            "The host did not respond. Restart the console from the Command Palette.",
          ),
        );
      }, 130000);
      pending.set(id, { resolve, reject, timer });
      vscode.postMessage({ ...message, id });
    });
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.kind === "definitions") {
      window.dispatchEvent(
        new CustomEvent("host-definitions", { detail: data.definitions }),
      );
      return;
    }
    if (data?.kind === "navigate") {
      if (!workspaceNavigation.validRoute(data.route)) return;
      if (
        data.connectionId &&
        data.connectionId !== state.overview?.connection?.id
      ) {
        toast(
          "Connection changed. Refresh the explorer before opening this table.",
          true,
        );
        return;
      }
      if (document.querySelector("dialog[open]")) {
        vscode.postMessage({ kind: "navigationBlocked" });
        return;
      }
      if (location.hash === "#" + data.route) navigate();
      else location.hash = "#" + data.route;
      return;
    }
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
  window.dynamoHost = Object.freeze({
    ready: () => vscode.postMessage({ kind: "ready" }),
    async fetch(path, options = {}) {
      const result = await call({
        kind: "request",
        path,
        method: options.method || "GET",
        headers: options.headers,
        body: options.body,
      });
      return new Response(result.body, {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    },
    copy: (text) => call({ kind: "copy", text }),
    download: (text, filename) => call({ kind: "download", text, filename }),
  });
  location.hash = "#settings";
})();

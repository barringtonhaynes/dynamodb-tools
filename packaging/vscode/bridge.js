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
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
  window.dynamoHost = Object.freeze({
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

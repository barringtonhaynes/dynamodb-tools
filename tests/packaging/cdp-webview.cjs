// CDP's flattened iframe session is needed for VS Code's custom-scheme webviews.
async function connectWebview(port) {
  const info = await (
    await fetch(`http://127.0.0.1:${port}/json/version`)
  ).json();
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const pending = new Map(),
    contexts = new Map();
  let sequence = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else if (message.method === "Runtime.executionContextCreated") {
      if (message.params.context.auxData?.isDefault)
        contexts.set(message.params.context.id, message.sessionId);
    } else if (message.method === "Runtime.executionContextDestroyed")
      contexts.delete(message.params.executionContextId);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetInfos } = await send("Target.getTargets");
  const target = targetInfos.find(
    (t) =>
      t.type === "iframe" &&
      t.url.includes("extensionId=barringtonhaynes.dynamodb-tools"),
  );
  if (!target) {
    socket.close();
    throw new Error("DynamoDB Tools webview target is missing");
  }
  const { sessionId } = await send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  await send("Runtime.enable", {}, sessionId);
  let contextId;
  for (let i = 0; i < 60 && !contextId; i++) {
    for (const [id, session] of contexts) {
      const result = await send(
        "Runtime.evaluate",
        {
          expression: '!!document.getElementById("connection-form")',
          contextId: id,
          returnByValue: true,
        },
        session,
      );
      if (result.result.value) {
        contextId = id;
        break;
      }
    }
    if (!contextId) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!contextId) {
    socket.close();
    throw new Error("Webview connection form did not render");
  }
  return {
    async evaluate(expression) {
      const result = await send(
        "Runtime.evaluate",
        { expression, contextId, awaitPromise: true, returnByValue: true },
        contexts.get(contextId),
      );
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text,
        );
      return result.result.value;
    },
    close() {
      socket.close();
    },
  };
}
module.exports = { connectWebview };

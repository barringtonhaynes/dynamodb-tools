"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const MAX_BODY = 32 * 1024 * 1024;

function validateRequest(message) {
  if (
    !message ||
    typeof message.path !== "string" ||
    message.path.length > 8192 ||
    !message.path.startsWith("/api/") ||
    message.path.includes("\\") ||
    /[\r\n#]/.test(message.path)
  )
    throw new Error("Invalid API path");
  const url = new URL(message.path, "http://127.0.0.1");
  if (
    url.origin !== "http://127.0.0.1" ||
    !url.pathname.startsWith("/api/") ||
    decodeURIComponent(url.pathname)
      .split("/")
      .some((p) => p === ".." || p === ".")
  ) {
    throw new Error("Invalid API path");
  }
  const method = message.method || "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
    throw new Error("Invalid method");
  if (
    message.body !== undefined &&
    (typeof message.body !== "string" ||
      Buffer.byteLength(message.body) > MAX_BODY)
  )
    throw new Error("Request exceeds 32 MiB");
  const headers = { "Content-Type": "application/json" };
  for (const [key, value] of Object.entries(message.headers || {})) {
    if (
      ["x-connection-id", "x-aws-challenge", "x-aws-confirmation"].includes(
        key.toLowerCase(),
      ) &&
      typeof value === "string" &&
      value.length <= 4096 &&
      !/[\r\n]/.test(value)
    )
      headers[key] = value;
  }
  return {
    path: url.pathname + url.search,
    method,
    headers,
    body: message.body,
  };
}

async function startService({
  executable,
  args = [],
  stateDir,
  startupTimeout = 45000,
  signal,
  onExit = () => {},
}) {
  if (signal?.aborted) throw new Error("Opening the console was cancelled.");
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(executable))
    throw new Error(
      "The bundled service is missing. Reinstall DynamoDB Tools for this platform.",
    );
  const child = spawn(executable, [...args, "--state-dir", stateDir], {
    cwd: stateDir,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stopping = false,
    exited = false,
    handshake;
  const requests = new Set();
  child.stdin.on("error", () => {});
  child.stderr.resume(); // Do not forward provider output or environment details to the renderer.
  const exit = new Promise((resolve) =>
    child.once("close", (code, signal) => {
      exited = true;
      for (const request of requests) request.abort();
      if (handshake && !stopping)
        onExit(
          new Error(
            `Local service stopped (${code ?? signal}). Reopen the console to restart it.`,
          ),
        );
      resolve();
    }),
  );
  const stop = async () => {
    if (stopping) return exit;
    stopping = true;
    for (const request of requests) request.abort();
    child.stdin.end();
    const timer = setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 12000);
    timer.unref();
    await exit;
    clearTimeout(timer);
  };
  try {
    handshake = await new Promise((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "The local service took too long to start. Check data-folder access and reinstall if necessary.",
            ),
          ),
        startupTimeout,
      );
      const fail = () => {
        clearTimeout(timer);
        reject(
          new Error(
            "The local service could not start. Check saved connection.json, workspace data version and folder permissions.",
          ),
        );
      };
      const cancel = () => {
        clearTimeout(timer);
        reject(new Error("Opening the console was cancelled."));
      };
      signal?.addEventListener("abort", cancel, { once: true });
      child.once("error", fail);
      child.once("exit", fail);
      child.stdout.on("data", function ready(chunk) {
        buffer += chunk.toString();
        if (buffer.length > 65536) return fail();
        if (!buffer.includes("\n")) return;
        try {
          const result = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
          const url = new URL(result.url);
          if (
            result.protocol !== 1 ||
            url.protocol !== "http:" ||
            url.hostname !== "127.0.0.1" ||
            !url.port ||
            url.pathname !== "/" ||
            url.search ||
            url.hash ||
            url.username ||
            url.password ||
            !/^[A-Za-z0-9_-]{40,128}$/.test(result.token)
          )
            throw new Error("Invalid service handshake");
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          child.removeListener("exit", fail);
          child.removeListener("error", fail);
          child.stdout.removeListener("data", ready);
          child.stdout.resume();
          resolve({ ...result, url: url.origin });
        } catch {
          fail();
        }
      });
    });
  } catch (error) {
    child.kill();
    await stop();
    throw error;
  }
  return {
    url: handshake.url,
    token: handshake.token,
    version: handshake.version,
    pid: child.pid,
    stop,
    async request(message) {
      if (stopping || exited)
        throw new Error("The local service is stopped. Reopen the console.");
      const request = validateRequest(message);
      const controller = new AbortController();
      requests.add(controller);
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const response = await fetch(handshake.url + request.path, {
          method: request.method,
          body: request.body,
          headers: {
            ...request.headers,
            Authorization: `Bearer ${handshake.token}`,
          },
          redirect: "error",
          signal: controller.signal,
        });
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) {
            controller.abort();
            throw new Error(
              "Response exceeds 64 MiB. Use a smaller query or export.",
            );
          }
          chunks.push(Buffer.from(chunk));
        }
        return {
          status: response.status,
          body: Buffer.concat(chunks).toString("utf8"),
        };
      } finally {
        clearTimeout(timer);
        requests.delete(controller);
      }
    },
  };
}
function bundledExecutable(root) {
  return path.join(
    root,
    "service",
    process.platform === "win32"
      ? "dynamodb-tools-service.exe"
      : "dynamodb-tools-service",
  );
}
module.exports = { startService, validateRequest, bundledExecutable };

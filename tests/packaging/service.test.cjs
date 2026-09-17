const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateRequest,
  startService,
} = require("../../packaging/shared/service.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("bridge cannot select a remote host, path, header or method", () => {
  for (const value of [
    "https://evil.example/api/local",
    "//evil.example/api/local",
    "/api/../health",
    "/api/%2e%2e/health",
    "/api/\\evil",
    "/api/local#secret",
  ]) {
    assert.throws(() => validateRequest({ path: value }));
  }
  assert.throws(() =>
    validateRequest({ path: "/api/local", method: "CONNECT" }),
  );
  const result = validateRequest({
    path: "/api/local",
    headers: {
      Authorization: "evil",
      Host: "evil",
      "X-AWS-Challenge": "real",
      "X-Connection-Id": "current",
    },
  });
  assert.equal(result.headers.Authorization, undefined);
  assert.equal(result.headers.Host, undefined);
  assert.equal(result.headers["X-AWS-Challenge"], "real");
});

test("missing bundled executable produces an actionable error", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ddb-missing-"));
  try {
    await assert.rejects(
      startService({
        executable: path.join(directory, "absent"),
        stateDir: directory,
      }),
      /Reinstall/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "packaged runtime owns auth, persistence, port and shutdown",
  { timeout: 90000, skip: !process.env.TEST_SERVICE },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ddb-bundle-"));
    let host;
    const key =
      'dynamodb-tools.saved-queries.v1:["account","eu-west-2","example"]';
    try {
      host = await startService({
        executable: process.env.TEST_SERVICE,
        stateDir: directory,
      });
      const firstURL = host.url;
      assert.equal((await fetch(host.url + "/api/local")).status, 401);
      let response = await host.request({ path: "/api/local" });
      assert.equal(JSON.parse(response.body).installed, true);
      response = await host.request({
        path: "/api/local/definition",
        method: "PUT",
        body: JSON.stringify({ key, value: "[]", revision: 0 }),
      });
      assert.equal(response.status, 200);
      await host.stop();
      await assert.rejects(fetch(firstURL + "/api/local"));
      host = await startService({
        executable: process.env.TEST_SERVICE,
        stateDir: directory,
      });
      response = await host.request({ path: "/api/local" });
      assert.equal(JSON.parse(response.body).definitions[key].value, "[]");
      assert.equal(
        (
          await host.request({
            path: "/api/local/definition",
            method: "PUT",
            body: JSON.stringify({ key, value: "[1]", revision: 0 }),
          })
        ).status,
        409,
      );
    } finally {
      if (host) await host.stop();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "failed startup and cancellation reap the owned child",
  { timeout: 20000 },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ddb-startup-"));
    const fixture = path.join(directory, "waiting.cjs");
    fs.writeFileSync(fixture, "setInterval(() => {}, 1000);");
    try {
      await assert.rejects(
        startService({
          executable: process.execPath,
          args: [fixture],
          stateDir: directory,
          startupTimeout: 100,
        }),
        /too long/,
      );
      const controller = new AbortController();
      const starting = startService({
        executable: process.execPath,
        args: [fixture],
        stateDir: directory,
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 100);
      await assert.rejects(starting, /cancelled/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "parent crash closes the frozen service even without normal deactivation",
  { timeout: 30000, skip: !process.env.TEST_SERVICE },
  async () => {
    const { spawn } = require("node:child_process");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ddb-crash-"));
    const script = path.join(directory, "parent.cjs");
    fs.writeFileSync(
      script,
      `const {startService}=require(${JSON.stringify(path.resolve("packaging/shared/service.cjs"))}); startService({executable:process.env.TEST_SERVICE,stateDir:process.argv[2]}).then(host=>console.log(host.url));`,
    );
    const parent = spawn(process.execPath, [script, directory], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    try {
      const url = await new Promise((resolve, reject) => {
        let text = "";
        parent.stdout.on("data", (chunk) => {
          text += chunk;
          if (text.includes("\n")) resolve(text.trim());
        });
        parent.on("error", reject);
        parent.on("exit", () =>
          reject(new Error("Parent exited before readiness")),
        );
      });
      assert.equal((await fetch(url + "/api/local")).status, 401);
      parent.kill("SIGKILL");
      let stopped = false;
      for (let i = 0; i < 80; i++) {
        try {
          await fetch(url + "/api/local");
        } catch {
          stopped = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert(stopped, "Orphan service must close when its stdin pipe closes");
    } finally {
      parent.kill("SIGKILL");
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

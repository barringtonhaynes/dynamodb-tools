const { runTests } = require("@vscode/test-electron");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ddb-vscode-"));
  const user = path.join(root, "user");
  const testWorkspace = path.join(root, "empty-workspace");
  const storage = path.join(
    user,
    "User/globalStorage/barringtonhaynes.dynamodb-tools/workspace",
  );
  await fs.mkdir(testWorkspace);
  await fs.mkdir(storage, { recursive: true });
  await fs.writeFile(
    path.join(storage, "connection.json"),
    JSON.stringify({
      dynamodb_mode: "local",
      aws_region: "us-east-1",
      aws_profile: null,
      dynamodb_endpoint_url:
        process.env.TEST_DDB_ENDPOINT || "http://127.0.0.1:18100",
      read_only: true,
    }),
  );
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  let browser;
  const running = runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
    extensionDevelopmentPath:
      process.env.T1_EXTENSION_PATH || path.resolve("packaging/vscode"),
    extensionTestsPath: path.resolve("tests/packaging/vscode-host.cjs"),
    extensionTestsEnv: {
      T1_UI_DIR: root,
      T1_TEST_RESULTS: path.resolve("test-results"),
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_ACCESS_KEY_ID: "testing",
      AWS_SECRET_ACCESS_KEY: "testing",
      AWS_DEFAULT_REGION: "us-east-1",
    },
    launchArgs: [
      testWorkspace,
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + user,
      "--extensions-dir=" + path.join(root, "extensions"),
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
    ],
  });
  const ui = (async () => {
    let failure;
    try {
      let ready = false;
      for (let i = 0; i < 180; i++) {
        try {
          await fs.access(path.join(root, "ready"));
          ready = true;
          break;
        } catch {
          await pause(500);
        }
      }
      assert(ready, "Extension did not become ready");
      browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
      const { connectWebview } = require("./cdp-webview.cjs");
      const webview = await connectWebview(port);
      try {
        assert(
          await webview.evaluate(
            '!!document.getElementById("export-workspace")',
          ),
        );
        await webview.evaluate(`(async () => {
          const key = 'dynamodb-tools.saved-queries.v1:["account","us-east-1","vscode"]:item-schema';
          await workspaceStorage.setItem(key, '{"type":"object"}');
          if (workspaceStorage.getItem(key) !== '{"type":"object"}') throw new Error('Bridge persistence failed');
          document.querySelector('[data-nav="tables"]').click();
        })()`);
        let tables = false;
        for (let i = 0; i < 60; i++) {
          tables = await webview.evaluate(
            '!!document.getElementById("table-rows")',
          );
          if (tables) break;
          await pause(250);
        }
        assert(tables, "Webview did not display local tables");
        assert.equal(
          await webview.evaluate("typeof window.require"),
          "undefined",
        );
        await browser
          .contexts()[0]
          .pages()[0]
          .screenshot({ path: "test-results/vscode-tables.png" });
        const axeSource = await fs.readFile(
          require.resolve("axe-core/axe.min.js"),
          "utf8",
        );
        await webview.evaluate(axeSource);
        const violations = await webview.evaluate(
          '(async()=> (await axe.run(document, {runOnly: {type:"tag", values:["wcag2a","wcag2aa","wcag21aa"]}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})))()',
        );
        await fs.writeFile(
          "test-results/axe-vscode.json",
          JSON.stringify(violations, null, 2),
        );
        assert.deepEqual(violations, []);
        if (process.env.TEST_VSCODE_THEMES) {
          await require("./vscode-themes.cjs").check({ webview, browser, root });
        }
      } finally {
        webview.close();
      }
      console.log(
        "VS Code webview: rendered console, API bridge, persisted schema and table discovery passed.",
      );
    } catch (error) {
      failure = error;
    }
    await fs.writeFile(
      path.join(root, "ui-done.json"),
      JSON.stringify({ error: failure?.message }),
    );
    if (failure) throw failure;
  })();
  try {
    await Promise.all([running, ui]);
  } finally {
    await running.catch(() => {});
    if (browser?.isConnected()) await browser.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

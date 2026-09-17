const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { connectWebview } = require("./cdp-webview.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.check = async ({ webview, browser, root, port }) => {
  const page = browser.contexts()[0].pages()[0];
  const wait = async (expression) => {
    for (let i = 0; i < 80; i++) {
      if (await webview.evaluate(expression)) return;
      await pause(150);
    }
    throw new Error("Sidebar navigation did not finish: " + expression);
  };
  const click = (label) =>
    page.getByRole("treeitem").filter({ hasText: label }).click();
  await webview.evaluate('window.sidebarPanelMarker = "same panel"');
  await click("Connection settings");
  await wait('!!document.getElementById("connection-form")');
  await click("Activity");
  await wait('state.route === "activity"');
  await click("Tables");
  await wait('!!document.getElementById("table-rows")');
  assert.equal(
    await webview.evaluate("window.sidebarPanelMarker"),
    "same panel",
  );
  await page.screenshot({ path: "test-results/vscode-sidebar.png" });
  await webview.evaluate('document.querySelector(".table-link").click()');
  await wait("!!document.querySelector('[data-action=\"edit-item\"]')");
  await webview.evaluate("itemDialog(0)");
  await wait('!!document.getElementById("item-editor")');
  await webview.evaluate(
    'window.sidebarDraft = document.getElementById("item-editor"); sidebarDraft.value = "unsaved sidebar draft"; sidebarDraft.dispatchEvent(new Event("input",{bubbles:true}));',
  );
  const route = await webview.evaluate("location.hash");
  await click("Connection settings");
  await page
    .getByText(
      "Close the current DynamoDB Tools dialog before navigating. Your draft is still open.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await webview.evaluate("location.hash"), route);
  assert.equal(
    await webview.evaluate('document.getElementById("item-editor").value'),
    "unsaved sidebar draft",
  );
  await webview.evaluate('document.querySelector("dialog[open]").close()');
  // Stop, then use the route command from a cold backend; it must wait for readiness.
  const command = async (id, command) => {
    await fs.writeFile(
      path.join(root, "sidebar-request.json"),
      JSON.stringify({ id, command }),
    );
    for (let i = 0; i < 160; i++) {
      try {
        if (
          JSON.parse(
            await fs.readFile(path.join(root, "sidebar-ready.json"), "utf8"),
          ).id === id
        )
          return;
      } catch {}
      await pause(150);
    }
    throw new Error("Sidebar host command timed out");
  };
  await command(1, "stop");
  webview.close();
  await command(2, "tables");
  await pause(500);
  const reopened = await connectWebview(
    port,
    '!!document.getElementById("table-rows")',
  );
  try {
    assert.equal(await reopened.evaluate("location.hash"), "#tables");
  } finally {
    reopened.close();
  }
  await fs.writeFile(
    "test-results/vscode-sidebar.json",
    JSON.stringify(
      {
        sidebarWithoutService: true,
        openByClick: true,
        warmRoutes: true,
        singlePanel: true,
        draftProtected: true,
        coldTablesRoute: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: native sidebar, click to open, warm/cold routes, single panel and protected draft.",
  );
};

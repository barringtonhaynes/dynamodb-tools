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
  const expand = async (row) => {
    if ((await row.getAttribute("aria-expanded")) !== "true")
      await row.locator(".monaco-tl-twistie").click();
  };
  const click = (label) =>
    page.getByRole("treeitem").filter({ hasText: label }).click();
  await webview.evaluate('window.sidebarPanelMarker = "same panel"');
  await click("Connection & access");
  await wait('!!document.getElementById("connection-form")');
  await click("Activity");
  await wait('state.route === "activity"');
  await click(/^Tables$/);
  await wait('!!document.getElementById("table-rows")');
  assert.equal(
    await webview.evaluate("window.sidebarPanelMarker"),
    "same panel",
  );
  assert.equal(
    await webview.evaluate(
      'getComputedStyle(document.getElementById("sidebar")).display',
    ),
    "none",
  );
  // Expand the native table list, then select a table directly.
  const tables = page.getByRole("treeitem").filter({ hasText: /^Tables$/ });
  await expand(tables);
  const table = await webview.evaluate("state.overview.tables[0].TableName");
  await click(new RegExp("^" + table + "(?:★)?$"));
  await wait("!!document.getElementById('favourite-table')");
  await webview.evaluate("toggleFavourite()");
  const favourites = page
    .getByRole("treeitem")
    .filter({ hasText: /^Favourites$/ });
  await expand(favourites);
  await wait(
    'document.getElementById("favourite-table").getAttribute("aria-pressed") === "true"',
  );
  await webview.evaluate(
    `window.sidebarReadCount = 0; const originalSidebarApi = api; api = async (...args) => { if (args[0].endsWith('/items/search')) window.sidebarReadCount++; return originalSidebarApi(...args); };`,
  );
  // Persist a query, then review it from its deep link without running a read.
  await webview.evaluate(`(async () => {
    await writeSavedQueries(savedQueryKey(), [{id:"sidebar-query", name:"Sidebar saved query", request:{mode:"scan",index:null,limit:25},filter:"",schema:querySchema(null)}]);
    location.hash = "#" + workspaceNavigation.tableRoute(state.table, {query:"sidebar-query"});
  })()`);
  await wait(
    'document.getElementById("page-label")?.textContent === "Not run yet"',
  );
  assert.equal(await webview.evaluate("state.savedQueryId"), "sidebar-query");
  // Expand the favourite and its saved query group and click the actual native query.
  const favouriteTable = page
    .getByRole("treeitem")
    .filter({ hasText: new RegExp("^" + table + "(?:★)?$") })
    .first();
  await expand(favouriteTable);
  const queries = page
    .getByRole("treeitem")
    .filter({ hasText: /^Saved queries$/ })
    .first();
  await expand(queries);
  const beforeQueryNavigation = await webview.evaluate("state.generation");
  await click("Sidebar saved query");
  await wait(`state.generation > ${beforeQueryNavigation}`);
  await wait(
    'document.getElementById("page-label")?.textContent === "Not run yet"',
  );
  assert.equal(await webview.evaluate("window.sidebarReadCount"), 0);
  await pause(300);
  await page.screenshot({ path: "test-results/vscode-sidebar.png" });
  await click("Schema & indexes");
  await wait(
    'state.detailTab === "schema" && !!document.querySelector(".schema-row")',
  );
  await click("Streams");
  await wait('state.detailTab === "streams"');
  await click("Items");
  await wait("!!document.querySelector('[data-action=\"edit-item\"]')");

  await wait("!!document.querySelector('[data-action=\"edit-item\"]')");
  await webview.evaluate("itemDialog(0)");
  await wait('!!document.getElementById("item-editor")');
  await webview.evaluate(
    'window.sidebarDraft = document.getElementById("item-editor"); sidebarDraft.value = "unsaved sidebar draft"; sidebarDraft.dispatchEvent(new Event("input",{bubbles:true}));',
  );
  const route = await webview.evaluate("location.hash");
  await click("Connection & access");
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
    assert.equal(
      await reopened.evaluate(
        "workspaceNavigation.favourites(state.overview.connection, workspaceStorage.entries()).length",
      ),
      1,
    );
    assert(
      await reopened.evaluate(
        'Object.values(workspaceStorage.entries()).some(value => value.includes("sidebar-query"))',
      ),
    );
  } finally {
    reopened.close();
  }
  await fs.writeFile(
    "test-results/vscode-sidebar.json",
    JSON.stringify(
      {
        sidebarWithoutService: true,
        expandableTablesAndSettings: true,
        duplicateSidebarHidden: true,
        directTableAndSectionNavigation: true,
        queryPreviewWithoutRead: true,
        favouritesAndQueriesSurviveRestart: true,
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

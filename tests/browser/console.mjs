import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { checkItemEditor } from "./item-editor.mjs";
import {
  checkAWSConnectionUI,
  checkAWSWriteSafetyUI,
  checkTableDiscoveryUI,
} from "./connection.mjs";
import { checkInsights } from "./insights.mjs";
import { checkWorkspace } from "./workspace.mjs";
import { assertIconBounds } from "./icon-layout.mjs";

const base = process.env.CONSOLE_TEST_URL;
assert(
  base,
  "Set CONSOLE_TEST_URL to a console backed by disposable DynamoDB Local.",
);
const name = `ui_test_${Date.now()}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
let createdTable = false;
page.on("pageerror", (error) => errors.push(error.message));
await fs.mkdir("test-results", { recursive: true });

async function operation(job) {
  for (let i = 0; i < 120; i++) {
    const result = await (
      await context.request.get(`${base}/api/operations/${job.id}`)
    ).json();
    if (result.status === "completed") return result;
    if (result.status === "failed") throw new Error(result.detail);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Operation timed out: ${job.action}`);
}
async function accessibility(label) {
  await assertIconBounds(page, label);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await fs.writeFile(
    `test-results/axe-${label}.json`,
    JSON.stringify(result.violations, null, 2),
  );
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
    [],
    `Accessibility: ${label}`,
  );
}
async function noPageOverflow() {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "The page overflows the viewport",
  );
}
async function jsonResponse(path, method, data) {
  const response = await context.request.fetch(base + path, { method, data });
  assert(response.ok(), await response.text());
  return response.json();
}

try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Workspace overview" }).waitFor();
  await accessibility("overview");
  await noPageOverflow();
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Create table", exact: true }).click();
  await page.getByLabel("Table name", { exact: true }).fill(name);
  await page.getByLabel("Partition key", { exact: true }).fill("pk");
  await page.getByLabel("Sort key", { exact: false }).fill("sk");
  await accessibility("create-dialog");
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/tables") && r.request().method() === "POST",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create table", exact: true })
    .click();
  await operation(await (await created).json());
  createdTable = true;
  await page.goto(`${base}/#tables/${name}`);
  await page.getByRole("heading", { name: /Nothing here yet/ }).waitFor();
  await accessibility("empty-table");

  await page
    .getByRole("button", { name: "Add item", exact: true })
    .first()
    .click();
  const item = {
    pk: { S: "person#ada" },
    sk: { S: "profile" },
    name: { S: "Ada Lovelace" },
    balance: { N: "12345678901234567890.123456789" },
  };
  await page
    .getByRole("textbox", { name: "DynamoDB JSON", exact: true })
    .fill(JSON.stringify(item, null, 2));
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await page.getByRole("cell", { name: "Ada Lovelace", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open item person#ada" }).click();
  await checkItemEditor({
    page,
    item,
    accessibility,
    noPageOverflow,
    jsonResponse,
    table: name,
  });
  item.name = { S: "Ada Byron Lovelace" };
  await page
    .getByRole("textbox", { name: "DynamoDB JSON", exact: true })
    .fill(JSON.stringify(item, null, 2));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("cell", { name: "Ada Byron Lovelace", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Open item person#ada" }).click();
  await page.getByRole("button", { name: "Delete item", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete item", exact: true })
    .click();
  await page.getByRole("heading", { name: "Nothing here yet" }).waitFor();

  await page.getByRole("tab", { name: "Import data" }).click();
  await accessibility("imports");
  const records = Array.from({ length: 60 }, (_, i) => ({
    pk: "orders",
    sk: `order#${String(i).padStart(3, "0")}`,
    customer: ["Ada Lovelace", "Grace Hopper", "Katherine Johnson"][i % 3],
    total: i + 0.25,
    status: i % 2 ? "shipped" : "pending",
  }));
  await page.locator("#upload-file").setInputFiles({
    name: "orders.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(records)),
  });
  await page.getByRole("button", { name: "Import 60 records" }).waitFor();
  const imported = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/tables/${name}/imports`) &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Import 60 records" }).click();
  await operation(await (await imported).json());
  await page.getByRole("tab", { name: "Items", exact: true }).click();
  await page.getByText("Page 1 · 25 items evaluated").waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Page 2 · 25 items evaluated").waitFor();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByText("Page 1 · 25 items evaluated").waitFor();
  await page
    .getByLabel("Filter items on this page")
    .fill("no-matching-customer");
  await page
    .getByRole("heading", { name: "No matches on this page" })
    .waitFor();
  await page.getByLabel("Filter items on this page").fill("");
  await page.getByLabel("Explore with").selectOption("query");
  await page.locator("#query-pk").fill("orders");
  await page.getByLabel("Sort condition").selectOption("between");
  await page.locator("#query-sk").fill("order#010");
  await page.getByLabel("Range end").fill("order#012");
  await page.getByRole("button", { name: "Run query" }).click();
  await page.getByText("Page 1 · 3 items evaluated").waitFor();
  await accessibility("explorer");
  await noPageOverflow();
  await page.getByRole("cell", { name: "order#010", exact: true }).waitFor();
  while (
    await page.getByRole("button", { name: "Dismiss notification" }).count()
  ) {
    await page
      .getByRole("button", { name: "Dismiss notification" })
      .first()
      .click();
  }
  await page.screenshot({
    path: "test-results/explorer-desktop.png",
    fullPage: true,
  });

  // Save the controls as edited, even before the query has been run.
  await page.getByLabel("Order", { exact: true }).selectOption("desc");
  await page.getByLabel("Page size").selectOption("50");
  await page.getByLabel("Filter items on this page").fill("Grace");
  await page.getByRole("button", { name: "Save query", exact: true }).click();
  await page.getByLabel("Query name").fill("Orders <recent>");
  await accessibility("save-query-dialog");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const savedId = await page.locator("#saved-query").inputValue();
  await page.reload();
  await page.getByText("Page 1 · 25 items evaluated").waitFor();
  await page.locator("#saved-query").selectOption(savedId);
  await page.getByRole("button", { name: "Load query", exact: true }).click();
  await page.getByText("Page 1 · 3 items evaluated").waitFor();
  assert.equal(await page.locator("#query-pk").inputValue(), "orders");
  assert.equal(await page.locator("#query-sk").inputValue(), "order#010");
  assert.equal(await page.getByLabel("Range end").inputValue(), "order#012");
  assert.equal(
    await page.getByLabel("Order", { exact: true }).inputValue(),
    "desc",
  );
  assert.equal(await page.getByLabel("Page size").inputValue(), "50");
  assert.equal(
    await page.getByLabel("Filter items on this page").inputValue(),
    "Grace",
  );
  assert.equal(await page.locator(".data-table tbody tr").count(), 1);

  // Rename preserves the saved definition; explicitly replacing captures edits.
  await page.getByLabel("Page size").selectOption("100");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByLabel("Query name").fill("Recent orders");
  await accessibility("manage-query-dialog");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await page.getByRole("button", { name: "Load query", exact: true }).click();
  assert.equal(await page.getByLabel("Page size").inputValue(), "50");
  await page.getByLabel("Page size").selectOption("100");
  await page.getByLabel("Range end").fill("order#015");
  await page.getByLabel("Filter items on this page").fill("");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByLabel("Replace saved settings").check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await page.getByRole("button", { name: "Load query", exact: true }).click();
  await page.getByText("Page 1 · 6 items evaluated").waitFor();
  assert.equal(await page.getByLabel("Page size").inputValue(), "100");

  await page.getByRole("button", { name: "Save query", exact: true }).click();
  await page.getByLabel("Query name").fill("recent ORDERS");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await page.getByText(/A query with this name already exists/).waitFor();
  await page.keyboard.press("Escape");
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("dynamodb-tools.saved-queries.v1:"),
    );
    return { key, value: localStorage.getItem(key) };
  });

  // A removed index must not silently fall back to the primary index.
  await page.evaluate(({ key, value }) => {
    const queries = JSON.parse(value);
    queries[0].request.index = "removed_index";
    localStorage.setItem(key, JSON.stringify(queries));
  }, stored);
  await page.getByRole("button", { name: "Load query", exact: true }).click();
  await page.getByText(/index no longer exists/).waitFor();
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, value),
    stored,
  );

  // Connection, region, and table scopes cannot expose another saved list.
  for (const [field, value] of [
    ["endpoint", "http://another-local:8000"],
    ["region", "eu-west-1"],
  ]) {
    await page.route("**/api/overview", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.connection[field] = value;
      await route.fulfill({ response, json: data });
    });
    await page.reload();
    await page.getByText("Page 1 · 25 items evaluated").waitFor();
    assert.equal(await page.locator("#saved-query option").count(), 1);
    await page.unroute("**/api/overview");
  }
  await page.reload();
  await page.getByText("Page 1 · 25 items evaluated").waitFor();
  await page.goto(`${base}/#tables/notable_people`);
  await page.locator("#saved-query").waitFor();
  assert.equal(await page.locator("#saved-query option").count(), 1);
  await page.goto(`${base}/#tables/${name}`);
  await page.locator("#saved-query").selectOption(savedId);
  await page.getByRole("button", { name: "Load query", exact: true }).click();
  await page.getByText("Page 1 · 6 items evaluated").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow();
  await accessibility("saved-queries-mobile");
  await page.screenshot({
    path: "test-results/saved-queries-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/saved-queries-desktop.png",
    fullPage: true,
  });

  // Storage failure keeps the dialog open and does not claim success.
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByLabel("Query name").fill("Cannot persist");
  await page.evaluate(() => {
    window.originalStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await page.getByText(/Could not save changes/).waitFor();
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalStorageSetItem;
  });
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), stored.key),
    stored.value,
  );
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete saved query", exact: true })
    .click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#saved-query option").count(), 2);
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete saved query", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete saved query", exact: true })
    .click();
  await page.reload();
  await page.getByText("Page 1 · 25 items evaluated").waitFor();
  assert.equal(await page.locator("#saved-query option").count(), 1);

  // Corrupt storage must not break the ordinary explorer or erase data.
  await page.evaluate(
    (key) => localStorage.setItem(key, "broken JSON"),
    stored.key,
  );
  await page.reload();
  await page.getByText(/Saved queries are unavailable/).waitFor();
  await page.getByText("Page 1 · 25 items evaluated").waitFor();
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), stored.key),
    "broken JSON",
  );
  await page.evaluate((key) => localStorage.removeItem(key), stored.key);
  await page.reload();
  await page.getByText("Page 1 · 25 items evaluated").waitFor();

  await checkWorkspace({
    page,
    table: name,
    operation,
    jsonResponse,
    accessibility,
    noPageOverflow,
  });

  await checkInsights({
    page,
    table: name,
    operation,
    jsonResponse,
    accessibility,
    noPageOverflow,
  });

  await checkAWSConnectionUI({
    page,
    table: name,
    accessibility,
    noPageOverflow,
  });
  await checkAWSWriteSafetyUI({
    page,
    table: name,
    accessibility,
    noPageOverflow,
  });
  await checkTableDiscoveryUI({
    page,
    table: name,
    accessibility,
    noPageOverflow,
  });

  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloaded;
  await download.saveAs("test-results/export.dynamodb.json");
  assert.equal(
    JSON.parse(await fs.readFile("test-results/export.dynamodb.json", "utf8"))
      .length,
    60,
  );

  await page.getByRole("tab", { name: "Schema & indexes" }).click();
  await accessibility("schema");
  await page.getByRole("tab", { name: "Manage table" }).click();
  await page.getByRole("button", { name: "Purge table", exact: true }).click();
  await page.locator("#confirmation").fill("wrong");
  await page
    .getByRole("button", { name: "Purge all items", exact: true })
    .click();
  await page
    .getByText("The table name does not match. Please type it exactly.")
    .waitFor();
  const untouched = await jsonResponse(
    `/api/tables/${name}/items/search`,
    "POST",
    { limit: 100 },
  );
  assert.equal(untouched.count, 60);
  await page.locator("#confirmation").fill(name);
  const purged = page.waitForResponse(
    (r) => r.url().endsWith("/purge") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Purge all items", exact: true })
    .click();
  await operation(await (await purged).json());
  const empty = await jsonResponse(
    `/api/tables/${name}/items/search`,
    "POST",
    {},
  );
  assert.equal(empty.count, 0);
  await page.getByRole("button", { name: "Delete table", exact: true }).click();
  await page.locator("#confirmation").fill(name);
  const deleted = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/tables/${name}`) &&
      r.request().method() === "DELETE",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete table", exact: true })
    .click();
  await operation(await (await deleted).json());
  createdTable = false;

  await page.goto(`${base}/#activity`);
  await page.getByRole("heading", { name: "Activity", exact: true }).waitFor();
  await accessibility("activity");
  await page.goto(`${base}/#settings`);
  await page.getByRole("heading", { name: "Workspace settings" }).waitFor();
  await accessibility("settings");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole("heading", { name: "Workspace overview" }).waitFor();
  await noPageOverflow();
  await accessibility("mobile");
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.locator('nav a[href="#tables"]').click();
  await page.getByRole("heading", { name: "Tables", exact: true }).waitFor();
  await noPageOverflow();
  await page.getByRole("button", { name: "Create table", exact: true }).click();
  await accessibility("mobile-dialog");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(
    "PASS: desktop/mobile, keyboard, accessibility, table/item CRUD, import preview, pagination, filtering, range queries, saved queries, server filters, projections, Streams, TTL, PartiQL, bulk deletion, export, purge, and delete.",
  );
} finally {
  if (createdTable) {
    const response = await context.request.delete(
      `${base}/api/tables/${name}`,
      {
        data: { confirmation: name },
      },
    );
    if (response.ok()) await operation(await response.json()).catch(() => {});
  }
  await browser.close();
}

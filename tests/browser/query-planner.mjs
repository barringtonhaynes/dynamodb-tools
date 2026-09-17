import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const base = process.env.CONSOLE_TEST_URL;
assert(base, "Use a disposable DynamoDB Local console");
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const name = "planner_test_" + Date.now();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let created = false,
  reads = 0;
page.on("request", (req) => {
  if (req.url().endsWith("/items/search")) reads++;
});
async function api(path, method = "GET", data) {
  const response = await context.request.fetch(base + path, { method, data });
  assert(response.ok(), await response.text());
  return response.json();
}
async function operation(job) {
  for (let i = 0; i < 100; i++) {
    const result = await api("/api/operations/" + job.id);
    if (result.status === "completed") return;
    assert.notEqual(result.status, "failed", result.detail);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Operation timed out");
}
async function compare() {
  await page
    .getByRole("button", { name: "Compare access paths", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Export plan", exact: true })
    .waitFor();
}
async function axe(label) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await fs.writeFile(
    `test-results/axe-planner-${label}.json`,
    JSON.stringify(result.violations, null, 2),
  );
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
}
try {
  await operation(
    await api("/api/tables", "POST", {
      definition: {
        TableName: name,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: ["pk", "sk", "openCustomerKey", "createdAt"].map(
          (AttributeName) => ({ AttributeName, AttributeType: "S" }),
        ),
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "open_orders",
            KeySchema: [
              { AttributeName: "openCustomerKey", KeyType: "HASH" },
              { AttributeName: "createdAt", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
          {
            IndexName: "keys_only",
            KeySchema: [{ AttributeName: "openCustomerKey", KeyType: "HASH" }],
            Projection: { ProjectionType: "KEYS_ONLY" },
          },
        ],
      },
    }),
  );
  created = true;
  await api(`/api/tables/${name}/items`, "PUT", {
    item: {
      pk: { S: "CUSTOMER#123" },
      sk: { S: "ORDER#2026-09-10" },
      openCustomerKey: { S: "CUSTOMER#123" },
      createdAt: { S: "2026-09-10" },
      total: { N: "123.45" },
    },
    createOnly: true,
  });
  await page.goto(`${base}/#tables/${name}?view=planner`);
  await page
    .getByRole("heading", { name: "Access-pattern query builder" })
    .waitFor();
  assert.equal(reads, 0, "Opening planner must not read items");
  await page.getByLabel("Start from a pattern").selectOption("collection");
  await compare();
  const primary = page.locator(".planner-candidate").filter({
    has: page.getByRole("heading", { name: "Base table", exact: true }),
  });
  await primary
    .getByRole("button", { name: "Use in Items · review first" })
    .click();
  await page.getByText("Query plan ready", { exact: true }).waitFor();
  assert.equal(reads, 0, "Using a plan must not execute it");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await page.getByText("123.45", { exact: true }).waitFor();
  assert.equal(reads, 1);
  await page.getByRole("tab", { name: "Query planner", exact: true }).click();
  await page.getByRole("heading", { name: "Last measured read" }).waitFor();
  await page.getByLabel("Start from a pattern").selectOption("sparse");
  await page.getByLabel("Returned attributes · one per line").fill("total");
  await compare();
  const gsi = page.locator(".planner-candidate").filter({
    has: page.getByRole("heading", { name: "open_orders", exact: true }),
  });
  await gsi
    .getByRole("button", { name: "Use in Items · review first" })
    .waitFor();
  assert(
    await page.getByText(/Not projected into this GSI:.*total/).isVisible(),
  );
  assert(
    await page
      .getByRole("heading", { name: "Proposed GSI design" })
      .isVisible(),
  );
  await axe("desktop");
  await page.screenshot({
    path: "test-results/query-planner-desktop.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export plan", exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), "utf8"));
  assert.equal(exported.format, "dynamodb-tools-query-plan");
  assert(exported.candidates.find((c) => c.name === "open_orders").awsRequest);
  assert(exported.proposal.reuse.includes("open_orders"));
  assert.equal(reads, 1, "Comparison and export must not run reads");
  await page.getByLabel("Require strongly consistent reads").check();
  await compare();
  assert.equal(await gsi.getByRole("button").count(), 0);
  assert(await gsi.getByText(/eventual consistency only/).isVisible());
  await page.getByLabel("Require strongly consistent reads").uncheck();
  await page.locator(".planner-condition").nth(1).getByRole("button").click();
  await compare();
  assert(
    await gsi.getByText(/omit matching items missing createdAt/).isVisible(),
  );
  await page
    .getByLabel("Allow indexed-items-only results", { exact: false })
    .check();
  await compare();
  await gsi
    .getByRole("button", { name: "Use in Items · review first" })
    .click();
  assert.equal(reads, 1);
  await page.getByRole("button", { name: "Save query", exact: true }).click();
  await page.getByLabel("Query name").fill("Open orders by customer");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await page
    .locator("#saved-query")
    .selectOption({ label: "Open orders by customer" });
  await page.reload();
  await page
    .locator("#saved-query")
    .selectOption({ label: "Open orders by customer" });
  await page.getByRole("button", { name: "Load query", exact: true }).click();
  await page.getByText("123.45", { exact: true }).waitFor();
  assert.equal(await page.locator("#query-index").inputValue(), "open_orders");
  await page.getByRole("tab", { name: "Query planner", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Start from a pattern").selectOption("collection");
  await compare();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await axe("mobile");
  await page.screenshot({
    path: "test-results/query-planner-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: metadata-only comparison, primary/GSI plans, projection/consistency/sparse coverage, explicit reads, last-read metrics, saved queries, export, desktop/mobile accessibility.",
  );
} finally {
  if (created)
    await operation(
      await api(`/api/tables/${name}`, "DELETE", { confirmation: name }),
    );
  await browser.close();
}

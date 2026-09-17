import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const base = process.env.CONSOLE_TEST_URL;
assert(base, "Use an isolated console backed by disposable DynamoDB Local");
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
context.setDefaultTimeout(10000);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const suffix = Date.now(),
  source = `copy_source_${suffix}`,
  target = `copy_target_${suffix}`;
const created = [];
async function api(path, method = "GET", data) {
  const r = await context.request.fetch(base + path, { method, data });
  assert(r.ok(), await r.text());
  return r.json();
}
async function operation(job) {
  for (let i = 0; i < 120; i++) {
    const r = await api("/api/operations/" + job.id);
    if (r.status === "completed") return r;
    assert.notEqual(r.status, "failed", r.detail);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Operation did not complete");
}
async function axe(label) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await fs.writeFile(
    `test-results/axe-copy-${label}.json`,
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
async function addRule(op, attr, value) {
  await page
    .getByRole("button", { name: "Add transformation", exact: true })
    .click();
  const row = page.locator(".copy-rule").last();
  await row.getByLabel("Change", { exact: true }).selectOption(op);
  await row.getByLabel("Attribute name", { exact: true }).fill(attr);
  if (op === "set") await row.getByLabel("JSON value").fill(value);
  if (op === "rename") await row.getByLabel("New name").fill(value);
}
async function previewDestination(policy = "skip") {
  await page.getByLabel("Destination table", { exact: true }).fill(target);
  await page.getByLabel("If the key already exists").selectOption(policy);
  await page
    .getByRole("button", { name: "Preview destination", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy reviewed batch", exact: true })
    .waitFor();
}
async function copyNow() {
  await page.locator("#copy-confirm").fill("COPY " + target);
  const request = page.waitForResponse(
    (r) => r.url().endsWith("/copies/execute") && r.status() === 202,
  );
  await page
    .getByRole("button", { name: "Copy reviewed batch", exact: true })
    .click();
  return operation(await (await request).json());
}
async function switchAccess(readOnly) {
  await page.goto(base + "/#settings/connection");
  await page
    .getByLabel("Access mode", { exact: true })
    .selectOption(String(readOnly));
  await page
    .getByRole("button", { name: "Save & connect", exact: true })
    .click();
  await page.getByRole("heading", { name: /^All tables/ }).waitFor();
  await page.getByRole("link", { name: "Copy data", exact: true }).click();
  await page.getByRole("heading", { name: "Copy data", exact: true }).waitFor();
}
try {
  for (const name of [source, target]) {
    const definition = {
      TableName: name,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        "pk",
        "sk",
        ...(name === source ? ["customer"] : []),
      ].map((AttributeName) => ({ AttributeName, AttributeType: "S" })),
    };
    if (name === source)
      definition.GlobalSecondaryIndexes = [
        {
          IndexName: "by_customer",
          KeySchema: [
            { AttributeName: "customer", KeyType: "HASH" },
            { AttributeName: "sk", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "KEYS_ONLY" },
        },
      ];
    await operation(await api("/api/tables", "POST", { definition }));
    created.push(name);
  }
  for (const sk of ["ORDER#1", "ORDER#2", "NOTE#1"])
    await api(`/api/tables/${source}/items`, "PUT", {
      item: {
        pk: { S: "CUSTOMER#1" },
        sk: { S: sk },
        customer: { S: "c1" },
        secret: { S: "remove me" },
        amount: { N: "9007199254740993123456" },
        tags: { SS: ["one", "two"] },
        payload: { B: "YWJj" },
      },
    });
  await api(`/api/tables/${target}/items`, "PUT", {
    item: {
      pk: { S: "CUSTOMER#1" },
      sk: { S: "ORDER#1" },
      keep: { S: "original" },
    },
  });
  await page.goto(`${base}/#tables/${source}`);
  await page
    .getByRole("button", { name: "Copy matching data", exact: true })
    .waitFor();
  await page.locator("#query-mode").selectOption("query");
  await page.locator("#query-index").selectOption("by_customer");
  await page.locator("#query-pk").fill("c1");
  await page.locator("#query-operator").selectOption("begins_with");
  await page.locator("#query-sk").fill("ORDER#");
  await page
    .getByRole("button", { name: "Copy matching data", exact: true })
    .click();
  await page.getByRole("heading", { name: "Copy data", exact: true }).waitFor();
  assert.match(
    await page.locator("#copy-query-label").textContent(),
    /Query.*by_customer/,
  );
  await addRule("remove", "secret");
  await addRule("rename", "payload", "blob");
  await addRule("set", "copiedBy", '"DynamoDB Tools"');
  await addRule("timestamp", "copiedAt");
  await page
    .getByRole("button", { name: "Capture & preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Export transformed JSON", exact: true })
    .waitFor();
  assert.match(await page.locator(".copy-summary").textContent(), /2 items/);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export transformed JSON", exact: true })
    .click();
  const items = JSON.parse(
    await fs.readFile(await (await download).path(), "utf8"),
  );
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.secret, undefined);
    assert.equal(item.amount.N, "9007199254740993123456");
    assert.deepEqual(item.blob, { B: "YWJj" });
    assert.deepEqual(item.tags, { SS: ["one", "two"] });
    assert.deepEqual(item.copiedBy, { S: "DynamoDB Tools" });
  }
  assert.equal(items[0].copiedAt.S, items[1].copiedAt.S);
  await switchAccess(true);
  await previewDestination();
  assert(
    await page
      .getByRole("button", { name: "Copy reviewed batch", exact: true })
      .isDisabled(),
  );
  await switchAccess(false);
  await previewDestination();
  await axe("desktop");
  await page.locator("#copy-destination").focus();
  await page.screenshot({
    path: "test-results/copy-data-desktop.png",
    fullPage: true,
  });
  const job = await copyNow();
  assert.equal(job.progress.written, 1);
  assert.equal(job.progress.skipped, 1);
  let targetItems = (
    await api(`/api/tables/${target}/items/search`, "POST", {})
  ).items;
  assert.equal(targetItems.length, 2);
  assert.equal(
    targetItems.find((i) => i.sk.S === "ORDER#1").keep.S,
    "original",
  );
  assert.equal(
    targetItems.find((i) => i.sk.S === "ORDER#2").copiedAt.S,
    items[0].copiedAt.S,
  );
  await previewDestination("replace");
  assert(await page.getByText(/Replace mode: an existing item/).isVisible());
  assert.equal((await copyNow()).progress.written, 2);
  targetItems = (await api(`/api/tables/${target}/items/search`, "POST", {}))
    .items;
  assert(targetItems.every((i) => !i.keep && i.copiedAt));
  const original = (await api(`/api/tables/${source}/items/search`, "POST", {}))
    .items;
  assert.equal(original.length, 3);
  assert(original.every((i) => i.secret && !i.copiedAt));
  // Verify bounded captures make incomplete coverage explicit and offer continuation.
  await page.getByLabel("Source table", { exact: true }).fill(source);
  await page.getByLabel("Maximum matched items").fill("1");
  await page
    .getByRole("button", { name: "Capture & preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare next batch", exact: true })
    .waitFor();
  assert(
    await page
      .getByText(/Partial selection: a read limit was reached/)
      .isVisible(),
  );
  await page
    .getByRole("button", { name: "Prepare next batch", exact: true })
    .click();
  await page.getByText(/starts at the continuation/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await axe("mobile");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.locator("#copy-source-table").focus();
  await page.screenshot({
    path: "test-results/copy-data-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: GSI access pattern, full-item hydration, transforms, typed export, frozen timestamps, staged connection switch, read-only target, conditional skip, explicit replacement, unchanged source, limits/continuation, desktop/mobile accessibility.",
  );
} finally {
  // Only this test's temporary batches and tables are removed.
  const preferences = (await api("/api/connection")).preferences;
  if (preferences.read_only)
    await api("/api/connection", "PUT", { ...preferences, read_only: false });
  for (const batch of await api("/api/copies"))
    if (batch.source.table === source)
      await api(`/api/copies/${batch.id}/discard`, "POST", {});
  for (const name of created.reverse())
    await operation(
      await api(`/api/tables/${name}`, "DELETE", { confirmation: name }),
    );
  await browser.close();
}

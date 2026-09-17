import assert from "node:assert/strict";

export async function checkWorkspace({
  page,
  table,
  operation,
  jsonResponse,
  accessibility,
  noPageOverflow,
}) {
  await page.getByText("Filters & read options", { exact: true }).click();
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  let row = page.locator(".filter-row");
  await row.locator(".filter-attribute").fill("status");
  await row.locator(".filter-value").fill("shipped");
  await page.getByLabel("Page size").selectOption("100");
  await page.getByLabel("Returned attributes").fill("customer");
  await page.getByLabel("Strongly consistent read (table").check();
  await page.getByRole("button", { name: "Run scan" }).click();
  await page.getByText("30 items ·", { exact: false }).waitFor();
  assert.equal(await page.locator(".data-table tbody tr").count(), 30);
  assert.equal(
    await page.getByRole("columnheader", { name: /status/ }).count(),
    0,
  );
  await accessibility("server-filters");
  await page.screenshot({
    path: "test-results/server-filters.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save query", exact: true }).click();
  await page.getByLabel("Query name").fill("Shipped orders");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await row.locator(".filter-value").fill("pending");
  await page.getByRole("button", { name: "Load query", exact: true }).click();
  await page.getByText("30 items ·", { exact: false }).waitFor();
  assert.equal(await page.locator(".filter-value").inputValue(), "shipped");
  await page
    .getByLabel("Filter mode", { exact: true })
    .selectOption("expression");
  await page
    .getByLabel("Filter expression", { exact: true })
    .fill("#total >= :min");
  await page.getByLabel("Attribute names (JSON)").fill('{"#total":"total"}');
  await page
    .getByLabel("Attribute values (DynamoDB JSON)")
    .fill('{":min":{"N":"50"}}');
  await page.getByRole("button", { name: "Run scan" }).click();
  await page.getByText("10 items ·", { exact: false }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow();
  await accessibility("filters-mobile");
  await page.screenshot({
    path: "test-results/filters-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Filter mode", { exact: true }).selectOption("builder");
  await page.getByRole("button", { name: /Remove filter/ }).click();
  await page.getByLabel("Returned attributes").fill("");
  await page.getByLabel("Strongly consistent read (table").uncheck();
  await page.getByRole("button", { name: "Run scan" }).click();
  await page.getByText("60 items ·", { exact: false }).waitFor();

  await page.getByRole("tab", { name: "Streams", exact: true }).click();
  await page.getByLabel("Capture changes").selectOption("true");
  const configured = page.waitForResponse(
    (r) => r.url().endsWith("/streams") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Apply stream settings" }).click();
  await operation(await (await configured).json());
  const key = { pk: { S: "stream-test" }, sk: { S: "record" } };
  await jsonResponse(`/api/tables/${table}/items`, "PUT", {
    item: { ...key, amount: { N: "1" } },
  });
  await jsonResponse(`/api/tables/${table}/items`, "PUT", {
    item: { ...key, amount: { N: "2" } },
    originalKey: key,
  });
  await page.getByRole("button", { name: "Refresh streams" }).click();
  await page.waitForFunction(
    () => document.getElementById("stream-shard")?.value,
  );
  await page.getByRole("button", { name: "Read records", exact: true }).click();
  await page.locator(".stream-record").first().waitFor();
  await page
    .locator(".stream-record")
    .filter({ hasText: "MODIFY" })
    .locator("summary")
    .click();
  await page.getByRole("heading", { name: "Before", exact: true }).waitFor();
  await page.getByRole("heading", { name: "After", exact: true }).waitFor();
  await accessibility("streams");
  await page.screenshot({ path: "test-results/streams.png", fullPage: true });
  await page.getByRole("button", { name: "Read next", exact: true }).click();
  await page
    .getByRole("heading", { name: "No records in this read" })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Read next", exact: true })
      .isEnabled(),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow();
  await accessibility("streams-mobile");
  await page.screenshot({
    path: "test-results/streams-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("tab", { name: "Manage table", exact: true }).click();
  await page.getByLabel("Expiration", { exact: true }).selectOption("true");
  await page.getByLabel("TTL attribute", { exact: true }).fill("expires_at");
  const ttl = page.waitForResponse(
    (r) => r.url().endsWith("/ttl") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Apply TTL settings" }).click();
  await operation(await (await ttl).json());
  const config = await jsonResponse(`/api/tables/${table}/ttl`, "GET");
  assert.equal(config.AttributeName, "expires_at");
  await accessibility("ttl");

  await page.getByRole("tab", { name: "PartiQL", exact: true }).click();
  await page
    .getByLabel("Statement", { exact: true })
    .fill(`SELECT * FROM "${table}" WHERE pk = ?`);
  await page
    .getByLabel("Parameters (DynamoDB JSON array)")
    .fill('[{"S":"stream-test"}]');
  await page
    .getByRole("button", { name: "Run statement", exact: true })
    .click();
  await page
    .locator("#partiql-status")
    .getByText("1 items returned", { exact: false })
    .waitFor();
  await accessibility("partiql");
  await page.screenshot({ path: "test-results/partiql.png", fullPage: true });
  await page
    .getByLabel("Statement", { exact: true })
    .fill(`UPDATE "${table}" SET amount = ? WHERE pk = ? AND sk = ?`);
  await page
    .getByLabel("Parameters (DynamoDB JSON array)")
    .fill('[{"N":"3"},{"S":"stream-test"},{"S":"record"}]');
  await page
    .getByRole("button", { name: "Run statement", exact: true })
    .click();
  await accessibility("partiql-confirmation");
  await page.keyboard.press("Escape");
  assert.deepEqual(
    (await jsonResponse(`/api/tables/${table}/items/get`, "POST", { key }))
      .amount,
    { N: "2" },
  );
  await page
    .getByRole("button", { name: "Run statement", exact: true })
    .click();
  await page.getByRole("button", { name: "Run write", exact: true }).click();
  await page
    .locator("#partiql-status")
    .getByText("Write completed", { exact: false })
    .waitFor();
  assert.deepEqual(
    (await jsonResponse(`/api/tables/${table}/items/get`, "POST", { key }))
      .amount,
    { N: "3" },
  );

  await page.getByRole("tab", { name: "Items", exact: true }).click();
  await page.getByText("61 items ·", { exact: false }).waitFor();
  await page.getByLabel("Filter items on this page").fill("stream-test");
  await page
    .getByRole("checkbox", { name: "Select all visible items", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  await page
    .getByLabel(`Type ${table} to confirm`, { exact: true })
    .fill("wrong");
  await page
    .getByRole("button", { name: "Delete selected items", exact: true })
    .click();
  await page
    .getByText("Type the exact table name to confirm deletion", { exact: true })
    .waitFor();
  await page
    .getByLabel(`Type ${table} to confirm`, { exact: true })
    .fill(table);
  await page
    .getByRole("button", { name: "Delete selected items", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("Filter items on this page").fill("");
  await page.getByText("60 items ·", { exact: false }).waitFor();
}

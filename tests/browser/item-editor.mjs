import assert from "node:assert/strict";

export async function checkItemEditor({
  page,
  item,
  accessibility,
  noPageOverflow,
  jsonResponse,
  table,
}) {
  const editor = () => page.locator("#item-editor");
  const view = (name) => page.getByRole("tab", { name, exact: true });
  const sample = {
    ...item,
    tags: { SS: ["math", "code"] },
    binary: { B: "AAEC/w==" },
    active: { BOOL: true },
    settings: { M: { level: { N: "1.234567890123456789" } } },
  };
  await editor().fill(JSON.stringify(sample));
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.waitForFunction(() =>
    document.getElementById("item-editor").value.includes("\n"),
  );
  assert(
    (await editor().inputValue()).includes('"12345678901234567890.123456789"'),
  );
  await accessibility("item-ddb");
  await page.screenshot({ path: "test-results/item-ddb.png", fullPage: true });

  // Invalid JSON stays in the current view and displays a line/column error.
  const typed = await editor().inputValue();
  await editor().fill('{\n"pk": }');
  await view("Standard JSON").click();
  await page
    .locator("#dialog-error")
    .getByText(/line 2, column/)
    .waitFor();
  assert.equal(
    await view("DynamoDB JSON").getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await editor().inputValue(), '{\n"pk": }');
  await editor().fill(typed);
  await view("Standard JSON").click();
  await page
    .getByRole("textbox", { name: "Standard JSON", exact: true })
    .waitFor();
  const plain = await editor().inputValue();
  assert(plain.includes('"balance": 12345678901234567890.123456789'));
  assert(plain.includes('"level": 1.234567890123456789'));
  await editor().fill(plain.replace("Ada Lovelace", "Ada in standard JSON"));
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await page.getByText("Valid DynamoDB item · Nothing saved yet.").waitFor();
  await accessibility("item-standard-json");
  await page.screenshot({
    path: "test-results/item-standard-json.png",
    fullPage: true,
  });

  await view("Attributes").click();
  await page.getByLabel("Value for name", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Value for name", { exact: true }).inputValue(),
    "Ada in standard JSON",
  );
  assert.equal(
    await page.getByLabel("Value for balance", { exact: true }).inputValue(),
    "12345678901234567890.123456789",
  );
  assert.equal(
    await page.getByLabel("Type for tags", { exact: true }).inputValue(),
    "SS",
  );
  assert.equal(
    await page.getByLabel("Type for binary", { exact: true }).inputValue(),
    "B",
  );
  assert(
    (await page
      .getByLabel("Value for pk", { exact: true })
      .getAttribute("readonly")) !== null,
  );
  assert(await page.getByLabel("Type for pk", { exact: true }).isDisabled());
  await page
    .getByLabel("Value for name", { exact: true })
    .fill("Ada in attributes");
  await page
    .getByLabel("Value for active", { exact: true })
    .selectOption("false");
  await page
    .getByRole("button", { name: "Add attribute", exact: true })
    .click();
  let row = page.locator(".attribute-row").last();
  await row.locator(".attribute-name").fill("extra");
  await row.locator(".attribute-value").fill("new field");
  await page
    .getByRole("button", { name: "Add attribute", exact: true })
    .click();
  await page.locator(".attribute-row").last().getByRole("button").click();
  assert.equal(
    await page.getByRole("button", { name: "Format", exact: true }).count(),
    0,
  );
  await page.locator(".dialog-body").evaluate((node) => {
    node.scrollTop = 0;
  });
  await accessibility("item-attributes");
  await page.screenshot({
    path: "test-results/item-attributes.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow();
  await accessibility("item-attributes-mobile");
  await page.getByRole("dialog").evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({
    path: "test-results/item-attributes-mobile.png",
    fullPage: true,
  });
  await view("Standard JSON").click();
  await page
    .getByRole("textbox", { name: "Standard JSON", exact: true })
    .waitFor();
  await accessibility("item-json-mobile");
  await page.screenshot({
    path: "test-results/item-json-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Keyboard switching stays within the editor tab list, not the table tabs.
  await view("Standard JSON").focus();
  await page.keyboard.press("Home");
  await page
    .getByRole("textbox", { name: "DynamoDB JSON", exact: true })
    .waitFor();
  const restored = JSON.parse(await editor().inputValue());
  assert.deepEqual(restored.tags, sample.tags);
  assert.deepEqual(restored.binary, sample.binary);
  assert.deepEqual(restored.settings, sample.settings);
  assert.deepEqual(restored.balance, sample.balance);
  assert.deepEqual(restored.active, { BOOL: false });
  assert.deepEqual(restored.extra, { S: "new field" });
  assert.deepEqual(restored.name, { S: "Ada in attributes" });

  // Fixed keys are enforced in the raw views too; invalid edits are retained.
  await editor().fill(JSON.stringify({ ...restored, pk: { S: "different" } }));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText(/Primary keys cannot be changed/).waitFor();
  await editor().fill(JSON.stringify(restored));
  await view("Standard JSON").click();
  await page
    .getByRole("textbox", { name: "Standard JSON", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const saved = await jsonResponse(`/api/tables/${table}/items/get`, "POST", {
    key: { pk: sample.pk, sk: sample.sk },
  });
  saved.tags.SS.sort();
  restored.tags.SS.sort();
  assert.deepEqual(saved, restored);
  await page.getByRole("button", { name: "Open item person#ada" }).click();
  await page
    .getByRole("textbox", { name: "DynamoDB JSON", exact: true })
    .waitFor();
}

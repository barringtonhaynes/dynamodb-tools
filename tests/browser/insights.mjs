import assert from "node:assert/strict";

export async function checkInsights({
  page,
  table,
  operation,
  jsonResponse,
  accessibility,
  noPageOverflow,
}) {
  const sampleTable = table + "_model";
  const path = `/api/tables/${sampleTable}`;
  await operation(
    await jsonResponse("/api/tables", "POST", {
      definition: {
        TableName: sampleTable,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: ["pk", "sk", "openKey"].map((AttributeName) => ({
          AttributeName,
          AttributeType: "S",
        })),
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "open_orders",
            KeySchema: [{ AttributeName: "openKey", KeyType: "HASH" }],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      },
    }),
  );
  try {
    const open = {
      pk: { S: "CUSTOMER#123" },
      sk: { S: "ORDER#new" },
      entityType: { S: "Order" },
      openKey: { S: "OPEN" },
      total: { N: "100.01" },
    };
    const closed = {
      pk: { S: "CUSTOMER#123" },
      sk: { S: "ORDER#closed" },
      entityType: { S: "Order" },
      total: { N: "99" },
    };
    await jsonResponse(path + "/items", "PUT", { item: open });
    await jsonResponse(path + "/items", "PUT", { item: closed });
    await page.goto(new URL("/#tables/" + sampleTable, page.url()).href);
    await page.getByRole("tab", { name: "Data model", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Next sample", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Read sample", exact: true })
      .click();
    await page.getByText("2 items", { exact: true }).waitFor();
    await page.getByText("1 eligible · 1 excluded · 0 invalid").waitFor();
    await accessibility("data-model");
    await page.screenshot({
      path: "test-results/data-model-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noPageOverflow();
    await accessibility("data-model-mobile");
    await page.screenshot({
      path: "test-results/data-model-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Query OPEN", exact: true }).click();
    await page.getByText("Page 1 · 1 items evaluated").waitFor();
    assert.equal(
      await page.getByLabel("Table / index", { exact: true }).inputValue(),
      "open_orders",
    );
    await page.getByRole("tab", { name: "Data model", exact: true }).click();
    await page
      .getByLabel("Partition key value", { exact: true })
      .fill("CUSTOMER#123");
    await page.getByLabel("Sort key prefix (optional)").fill("ORDER#");
    await page.getByRole("button", { name: "Open query", exact: true }).click();
    await page.getByText("Page 1 · 2 items evaluated").waitFor();
    assert.equal(
      await page.getByLabel("Sort condition").inputValue(),
      "begins_with",
    );
    assert.match(
      await page.locator("#item-result-label").textContent(),
      /returned \(est\.\)/,
    );
    await page
      .getByRole("button", { name: "Open item CUSTOMER#123", exact: true })
      .last()
      .click();
    await page
      .locator("#item-insights")
      .getByText(/estimated item size/)
      .waitFor();
    assert((await page.locator(".syntax-paint .json-key").count()) > 0);
    await page.getByRole("tab", { name: "Standard JSON", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Standard JSON", exact: true })
      .waitFor();
    const text = await page.locator("#item-editor").inputValue();
    await page
      .getByText("Optional item schema · JSON Schema", { exact: true })
      .click();
    const schema =
      '{"type":"object","required":["entityType","total"],"properties":{"entityType":{"const":"Order"},"total":{"type":"number","minimum":0}}}';
    await page.getByLabel("Item schema", { exact: true }).fill(schema);
    await page
      .getByRole("button", { name: "Remember schema", exact: true })
      .click();
    await page
      .getByText("Item schema saved for this table in this browser.", {
        exact: true,
      })
      .waitFor();
    await page
      .locator("#item-editor")
      .fill(text.replace(/"total": [\d.]+/, '"total": -1'));
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page
      .locator("#dialog-error")
      .getByText(/less than the minimum/)
      .waitFor();
    assert.equal(await page.getByRole("dialog").isVisible(), true);
    await page.locator("#item-editor").fill(text);
    await page.getByRole("button", { name: "Validate", exact: true }).click();
    await page
      .getByText("Valid DynamoDB item · Nothing saved yet.", { exact: true })
      .waitFor();
    await accessibility("item-schema-size");
    await page.screenshot({
      path: "test-results/item-schema-size.png",
      fullPage: true,
    });
    await page.getByLabel("Item schema", { exact: true }).fill("");
    await page
      .getByRole("button", { name: "Remember schema", exact: true })
      .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await operation(
      await jsonResponse(path, "DELETE", { confirmation: sampleTable }),
    );
  }
  await page.goto(new URL("/#tables/" + table, page.url()).href);
  await page.getByRole("tab", { name: "Items", exact: true }).waitFor();
}

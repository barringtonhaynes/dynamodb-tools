import assert from "node:assert/strict";

// Display-only AWS metadata fixture. All database traffic stays on DynamoDB Local.
export async function checkAWSConnectionUI({
  page,
  table,
  accessibility,
  noPageOverflow,
}) {
  await page.route("**/api/overview", async (route) => {
    const result = await (await route.fetch()).json();
    result.connection = {
      ...result.connection,
      mode: "aws",
      endpoint: "https://dynamodb.eu-west-2.amazonaws.com",
      region: "eu-west-2",
      account: "123456789012",
      principal: "arn:aws:sts::123456789012:assumed-role/Development/demo",
      profile: "development",
      readOnly: true,
    };
    await route.fulfill({ json: result });
  });
  await page.route("**/api/settings", async (route) => {
    const result = await (await route.fetch()).json();
    Object.assign(result.settings, {
      dynamodb_mode: "aws",
      aws_profile: "development",
      read_only: true,
      dynamodb_endpoint_url: "AWS regional endpoints",
    });
    for (const key in result.settings)
      if (key.endsWith("_on_startup")) result.settings[key] = false;
    await route.fulfill({ json: result });
  });
  await page.route("**/api/connection", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      assert.equal(body.aws_profile, null);
      assert.equal(body.aws_region, null);
      await route.fulfill({
        json: {
          id: "simulated",
          account: "123456789012",
          region: "eu-west-2",
          readOnly: true,
        },
      });
    } else
      await route.fulfill({
        json: {
          preferences: {
            dynamodb_mode: "aws",
            aws_profile: null,
            aws_region: null,
            read_only: true,
            dynamodb_endpoint_url: "http://localhost:8000",
          },
          profiles: ["development"],
          path: "/preferences/connection.json",
          saved: false,
        },
      });
  });
  await page.route("**/api/connection/test", (route) =>
    route.fulfill({
      json: { account: "123456789012", region: "eu-west-2", readOnly: true },
    }),
  );
  try {
    await page.reload();
    await page
      .getByText("AWS account 123456789012 · eu-west-2 · Read-only", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Add item", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Export", exact: true })
        .isEnabled(),
      true,
    );
    await page.getByRole("tab", { name: "Streams", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Apply stream settings", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("tab", { name: "Manage table", exact: true }).click();
    assert.equal(
      await page.locator(".aws-danger-zone").getAttribute("open"),
      null,
    );
    await page
      .getByText("Danger zone · real AWS data", { exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Purge table", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Apply TTL settings", exact: true })
        .isDisabled(),
      true,
    );
    await page.goto(new URL("/#settings", page.url()).href);
    await page
      .getByRole("heading", { name: "Workspace settings", exact: true })
      .waitFor();
    await page.getByText("development", { exact: true }).waitFor();
    await page
      .getByRole("heading", { name: "Choose a connection", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("AWS profile", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page.getByLabel("AWS region", { exact: true }).inputValue(),
      "",
    );
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await page
      .locator("#connection-feedback")
      .getByText(/Connected.*123456789012/)
      .waitFor();
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Save & connect", exact: true }).click(),
    ]);
    await page
      .getByRole("heading", { name: "Choose a connection", exact: true })
      .waitFor();
    await accessibility("aws-settings");
    await page.screenshot({
      path: "test-results/aws-settings-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noPageOverflow();
    await accessibility("aws-settings-mobile");
    await page.screenshot({
      path: "test-results/aws-settings-mobile.png",
      fullPage: true,
    });
  } finally {
    await page.unroute("**/api/overview");
    await page.unroute("**/api/settings");
    await page.unroute("**/api/connection");
    await page.unroute("**/api/connection/test");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(new URL("/#tables/" + table, page.url()).href);
    await page.reload();
    await page.getByRole("tab", { name: "Items", exact: true }).waitFor();
  }
}

// Write requests are intercepted: no test mutation reaches a real account or table.
export async function checkAWSWriteSafetyUI({
  page,
  table,
  accessibility,
  noPageOverflow,
}) {
  let attempts = 0;
  let executions = 0;
  let firstBody;
  const phrase = `APPLY 123456789012 eu-west-2 ${table}`;
  const target = `**/api/tables/${table}`;
  await page.route("**/api/overview", async (route) => {
    const result = await (await route.fetch()).json();
    Object.assign(result.connection, {
      mode: "aws",
      readOnly: false,
      account: "123456789012",
      region: "eu-west-2",
    });
    await route.fulfill({ json: result });
  });
  await page.route(target, async (route) => {
    const request = route.request();
    if (request.method() !== "DELETE") return route.fallback();
    const headers = request.headers();
    if (headers["x-aws-challenge"]) {
      assert.equal(headers["x-aws-challenge"], "single-use-2");
      assert.equal(headers["x-aws-confirmation"], phrase);
      assert.equal(request.postData(), firstBody);
      executions++;
      return route.fulfill({
        status: 400,
        json: { detail: "Simulated AWS response: table preserved" },
      });
    }
    attempts++;
    firstBody = request.postData();
    return route.fulfill({
      status: 428,
      json: {
        awsConfirmation: {
          token: `single-use-${attempts}`,
          phrase,
          account: "123456789012",
          region: "eu-west-2",
          target: table,
          action: "Delete table",
          waitSeconds: 5,
          expiresSeconds: 120,
        },
      },
    });
  });
  try {
    await page.reload();
    await page.getByRole("tab", { name: "Manage table", exact: true }).click();
    assert.equal(
      await page.locator(".aws-danger-zone").getAttribute("open"),
      null,
    );
    assert.equal(
      await page.locator('[data-action="delete-table"]').isVisible(),
      false,
    );
    await page
      .getByText("Danger zone · real AWS data", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete table", exact: true })
      .click();
    await page.locator("#confirmation").fill(table);
    await page
      .locator("#dialog")
      .getByRole("button", { name: "Delete table", exact: true })
      .click();
    const cloud = page.locator(".aws-confirmation");
    await cloud.waitFor();
    await cloud.locator("input").fill(phrase);
    assert.equal(
      await cloud
        .getByRole("button", { name: "Apply this AWS change" })
        .isDisabled(),
      true,
    );
    await cloud.getByRole("button", { name: "Cancel change" }).click();
    await page
      .locator("#dialog-error")
      .getByText(/AWS change cancelled/)
      .waitFor();
    assert.equal(executions, 0);
    assert.equal(await page.locator("#confirmation").inputValue(), table);
    await page
      .locator("#dialog")
      .getByRole("button", { name: "Delete table", exact: true })
      .click();
    await cloud.waitFor();
    await cloud.locator("input").fill("yes");
    assert.equal(
      await cloud
        .getByRole("button", { name: "Apply this AWS change" })
        .isDisabled(),
      true,
    );
    await accessibility("aws-danger-confirmation");
    await page.screenshot({
      path: "test-results/aws-danger-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noPageOverflow();
    await accessibility("aws-danger-mobile");
    await page.screenshot({
      path: "test-results/aws-danger-mobile.png",
      fullPage: true,
    });
    await cloud.locator("input").fill(phrase);
    await cloud.getByRole("button", { name: "Apply this AWS change" }).click();
    await page
      .locator("#dialog-error")
      .getByText("Simulated AWS response: table preserved", { exact: true })
      .waitFor();
    assert.equal(executions, 1);
    assert.equal(attempts, 2);
    await page.keyboard.press("Escape");
  } finally {
    await page.unroute("**/api/overview");
    await page.unroute(target);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(new URL("/#tables/" + table, page.url()).href);
    await page.reload();
    await page.getByRole("tab", { name: "Items", exact: true }).waitFor();
  }
}

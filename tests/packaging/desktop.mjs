import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "ddb-desktop-test-"));
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace);
await fs.writeFile(
  path.join(workspace, "connection.json"),
  JSON.stringify({
    dynamodb_mode: "local",
    aws_region: "us-east-1",
    aws_profile: null,
    dynamodb_endpoint_url:
      process.env.TEST_DDB_ENDPOINT || "http://127.0.0.1:18100",
    read_only: true,
  }),
);
const executablePath = process.env.TEST_DESKTOP;
assert(
  executablePath,
  "Set TEST_DESKTOP to the packaged application executable",
);
const key =
  'dynamodb-tools.saved-queries.v1:["http://127.0.0.1:18100","us-east-1","portable"]:item-schema';
let app;
try {
  app = await electron.launch({
    executablePath,
    args: ["--user-data-dir=" + root],
    env: {
      ...process.env,
      PATH: "",
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_ACCESS_KEY_ID: "testing",
      AWS_SECRET_ACCESS_KEY: "testing",
    },
  });
  let page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Workspace settings" }).waitFor();
  await page
    .getByRole("heading", { name: "Saved workspace", exact: true })
    .waitFor();
  assert(
    await page
      .getByText("Saved on this computer, across app restarts and upgrades.")
      .isVisible(),
  );
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.process), "undefined");
  assert(await page.locator("#confirm-workspace-import").isHidden());
  const transferFile = path.join(root, "transfer.json");
  await fs.writeFile(
    transferFile,
    JSON.stringify({
      format: "dynamodb-tools-workspace",
      version: 1,
      definitions: { [key]: '{"type":"object"}' },
    }),
  );
  await page.locator("#workspace-file").setInputFiles(transferFile);
  await page
    .getByText(
      "1 new definitions to import. 0 existing definitions will be kept.",
    )
    .waitFor();
  await page.getByRole("button", { name: "Import new definitions" }).click();
  await page
    .getByText(
      "Imported 1 definitions. Your previous definitions are unchanged.",
    )
    .waitFor();
  await page.locator("#workspace-file").setInputFiles(transferFile);
  await page
    .getByText(
      "0 new definitions to import. 1 existing definitions will be kept.",
    )
    .waitFor();
  assert(await page.locator("#confirm-workspace-import").isHidden());
  const exportFile = path.join(root, "export.json");
  const downloaded = app.evaluate(
    ({ BrowserWindow }, target) =>
      new Promise((resolve) => {
        BrowserWindow.getAllWindows()[0].webContents.session.once(
          "will-download",
          (_event, item) => {
            item.setSavePath(target);
            item.once("done", (_event, status) => resolve(status));
          },
        );
      }),
    exportFile,
  );
  await page.getByRole("button", { name: "Export workspace" }).click();
  assert.equal(await downloaded, "completed");
  assert.equal(
    JSON.parse(await fs.readFile(exportFile, "utf8")).definitions[key],
    '{"type":"object"}',
  );
  await page.screenshot({
    path: "test-results/desktop-settings.png",
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await fs.writeFile(
    "test-results/axe-desktop.json",
    JSON.stringify(axe.violations, null, 2),
  );
  assert.equal(axe.violations.length, 0);
  const url = new URL(page.url()).origin;
  assert.equal((await fetch(url + "/api/local")).status, 401);
  await page
    .getByRole("link", { name: "API reference", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "API reference", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close reference" }).click();
  await page.getByRole("link", { name: /^Tables/ }).click();
  await page.getByRole("heading", { name: "All tables" }).waitFor();
  assert.deepEqual(errors, []);
  await app.close();
  app = undefined;
  await assert.rejects(fetch(url + "/api/local"));
  app = await electron.launch({
    executablePath,
    args: ["--user-data-dir=" + root],
  });
  page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "Saved workspace", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate((key) => workspaceStorage.getItem(key), key),
    '{"type":"object"}',
  );
  await app.close();
  app = undefined;
  console.log(
    "Packaged Electron: settings, tables, accessibility, renderer isolation, auth, persistence and shutdown passed.",
  );
} finally {
  if (app) await app.close();
  await fs.rm(root, { recursive: true, force: true });
}

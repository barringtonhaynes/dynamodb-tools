const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
exports.run = async function () {
  const extension = vscode.extensions.getExtension(
    "barringtonhaynes.dynamodb-tools",
  );
  assert(extension, "Installed development extension must be discoverable");
  await extension.activate();
  await vscode.commands.executeCommand("dynamodbTools.open");
  for (
    let i = 0;
    i < 50 &&
    !vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) => tab.label === "DynamoDB Tools"),
    );
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert(
    vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) => tab.label === "DynamoDB Tools"),
    ),
  );
  if (process.env.T1_UI_DIR) {
    await fs.writeFile(path.join(process.env.T1_UI_DIR, "ready"), "ready");
    let result;
    for (let i = 0; i < 240; i++) {
      try {
        result = JSON.parse(
          await fs.readFile(
            path.join(process.env.T1_UI_DIR, "ui-done.json"),
            "utf8",
          ),
        );
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    assert(result, "Webview UI check timed out");
    assert(!result.error, result.error);
  }
  await vscode.commands.executeCommand("dynamodbTools.stop");
  await vscode.commands.executeCommand("dynamodbTools.open");
  await vscode.commands.executeCommand("dynamodbTools.restart");
  await vscode.commands.executeCommand("dynamodbTools.stop");
  await fs.writeFile(
    path.join(process.env.T1_TEST_RESULTS, "vscode-host.json"),
    JSON.stringify(
      {
        activated: true,
        opened: true,
        stopped: true,
        reopened: true,
        restarted: true,
      },
      null,
      2,
    ),
  );
};

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const info = JSON.parse(
  fs.readFileSync(path.join(root, "build/runtime/build-info.json"), "utf8"),
);
const target = `${process.platform}-${process.arch}`;
if (
  !["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"].includes(target) ||
  info.platform !== process.platform ||
  info.arch !== process.arch
) {
  throw new Error(
    "Build the Python service natively for this supported OS/architecture before packaging a VSIX.",
  );
}
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const version = require("../packaging/vscode/package.json").version;
const result = spawnSync(
  process.execPath,
  [
    require.resolve("@vscode/vsce/vsce"),
    "package",
    "--no-dependencies",
    // PyInstaller's macOS framework contains directory links; VSIX needs their files.
    "--follow-symlinks",
    "--target",
    target,
    "--out",
    path.join(root, `dist/dynamodb-tools-${version}-${target}.vsix`),
  ],
  { cwd: path.join(root, "packaging/vscode"), stdio: "inherit" },
);
process.exit(result.status ?? 1);

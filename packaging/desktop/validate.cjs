const fs = require("node:fs");
const path = require("node:path");
const { Arch } = require("builder-util");
module.exports = async (context) => {
  const info = JSON.parse(
    fs.readFileSync(
      path.join(context.packager.projectDir, "build/runtime/build-info.json"),
      "utf8",
    ),
  );
  if (
    info.platform !== context.electronPlatformName ||
    info.arch !== Arch[context.arch]
  ) {
    throw new Error(
      "The frozen Python service does not match this desktop target. Build on the target OS/architecture first.",
    );
  }
};

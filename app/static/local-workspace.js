/* The same console runs in a browser, Electron, and the VS Code message bridge. */
const consoleFetch = (url, options) =>
  window.dynamoHost
    ? window.dynamoHost.fetch(url, options)
    : fetch(url, options);
const workspaceStorage = {
  installed: false,
  definitions: {},
  getItem(key) {
    return this.installed
      ? this.definitions[key]?.value || null
      : localStorage.getItem(key);
  },
  async setItem(key, value) {
    if (!this.installed) {
      localStorage.setItem(key, value);
      return;
    }
    const result = await send("/api/local/definition", "PUT", {
      key,
      value,
      revision: this.definitions[key]?.revision || 0,
    });
    this.definitions[key] = result;
  },
  entries() {
    if (this.installed)
      return Object.fromEntries(
        Object.entries(this.definitions).map(([key, record]) => [
          key,
          record.value,
        ]),
      );
    return Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith("dynamodb-tools.saved-queries.v1:"))
        .map((key) => [key, localStorage.getItem(key)]),
    );
  },
};
async function initializeLocalWorkspace() {
  const response = await consoleFetch("/api/local");
  if (!response.ok)
    throw new Error(
      "Could not open saved workspace data. Reopen the console from its host.",
    );
  const data = await response.json();
  workspaceStorage.installed = data.installed === true;
  workspaceStorage.definitions = data.definitions || {};
}
async function saveDownload(text, filename) {
  if (window.dynamoHost) return window.dynamoHost.download(text, filename);
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function validateWorkspaceImport(text) {
  if (new TextEncoder().encode(text).length > 32 * 1024 * 1024)
    throw new Error("Workspace export exceeds 32 MiB.");
  const data = JSON.parse(text);
  if (
    data.format !== "dynamodb-tools-workspace" ||
    data.version !== 1 ||
    !data.definitions ||
    typeof data.definitions !== "object" ||
    Array.isArray(data.definitions)
  )
    throw new Error("Choose a DynamoDB Tools workspace export (version 1).");
  for (const [key, value] of Object.entries(data.definitions)) {
    if (
      !key.startsWith("dynamodb-tools.saved-queries.v1:") ||
      key.length > 2048 ||
      typeof value !== "string" ||
      new TextEncoder().encode(value).length > 2 * 1024 * 1024
    )
      throw new Error("Invalid saved definition.");
    const scope = JSON.parse(
      key
        .slice("dynamodb-tools.saved-queries.v1:".length)
        .replace(/:item-schema$/, ""),
    );
    if (
      !Array.isArray(scope) ||
      scope.length !== 3 ||
      scope.some((v) => typeof v !== "string" || !v)
    )
      throw new Error("Invalid connection/table scope.");
    const parsed = value ? JSON.parse(value) : null;
    if (key.endsWith(":item-schema")) {
      if (
        value &&
        !(
          typeof parsed === "boolean" ||
          (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        )
      )
        throw new Error("Invalid item schema.");
    } else if (
      !Array.isArray(parsed) ||
      parsed.some(
        (q) =>
          !q ||
          typeof q.id !== "string" ||
          typeof q.name !== "string" ||
          typeof q.filter !== "string" ||
          typeof q.schema !== "string" ||
          !q.request ||
          !["scan", "query"].includes(q.request.mode),
      )
    )
      throw new Error("Invalid saved queries.");
  }
  return data.definitions;
}
function renderWorkspaceTransfer() {
  const section = document.createElement("section");
  section.className = "panel workspace-transfer";
  section.innerHTML = `<div class="panel-heading"><div><h2>Saved workspace</h2><p>${workspaceStorage.installed ? "Saved on this computer, across app restarts and upgrades." : "Saved in this browser. Export to move into the desktop app or VS Code."}</p></div>${icon("bookmark")}</div><div class="panel-body"><p class="info-note">Transfer saved queries and item schemas. Connection settings, credentials and table contents are not included. Existing definitions are kept when you import.</p><div class="button-group"><button class="button" id="export-workspace">${icon("download")}Export workspace</button><button class="button" id="import-workspace">${icon("upload")}Import workspace</button><input type="file" id="workspace-file" accept=".json,application/json" hidden></div><p id="workspace-import-status" role="status"></p><button class="button primary" id="confirm-workspace-import" hidden>Import new definitions</button></div>`;
  document.querySelector(".settings-grid").after(section);
  section.querySelector("#export-workspace").onclick = async () => {
    try {
      await saveDownload(
        JSON.stringify(
          {
            format: "dynamodb-tools-workspace",
            version: 1,
            definitions: workspaceStorage.entries(),
          },
          null,
          2,
        ),
        "dynamodb-tools-workspace.json",
      );
    } catch (error) {
      toast(error.message, true);
    }
  };
  const file = section.querySelector("#workspace-file"),
    confirm = section.querySelector("#confirm-workspace-import"),
    status = section.querySelector("#workspace-import-status");
  section.querySelector("#import-workspace").onclick = () => file.click();
  let incoming;
  file.onchange = async () => {
    confirm.hidden = true;
    incoming = null;
    try {
      if (!file.files[0]) return;
      if (file.files[0].size > 32 * 1024 * 1024)
        throw new Error("Workspace export exceeds 32 MiB.");
      const definitions = validateWorkspaceImport(await file.files[0].text());
      const existing = workspaceStorage.entries();
      incoming = Object.entries(definitions).filter(
        ([key]) => !(key in existing),
      );
      status.textContent = `${incoming.length} new definitions to import. ${Object.keys(definitions).length - incoming.length} existing definitions will be kept.`;
      confirm.hidden = incoming.length === 0;
    } catch (error) {
      status.textContent = error.message;
    }
    file.value = "";
  };
  confirm.onclick = async () => {
    confirm.disabled = true;
    let count = 0;
    try {
      for (const [key, value] of incoming || []) {
        if (key in workspaceStorage.entries()) continue;
        await workspaceStorage.setItem(key, value);
        count++;
      }
      status.textContent = `Imported ${count} definitions. Your previous definitions are unchanged.`;
      confirm.hidden = true;
      incoming = null;
    } catch (error) {
      status.textContent = `Imported ${count} definitions before stopping: ${error.message}`;
    } finally {
      confirm.disabled = false;
    }
  };
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest('a[href="/docs"]');
  if (!link || !workspaceStorage.installed) return;
  event.preventDefault();
  try {
    const schema = await api("/api/local/openapi");
    const endpoints = Object.entries(schema.paths)
      .flatMap(([path, methods]) =>
        Object.entries(methods)
          .filter(([method]) =>
            ["get", "post", "put", "patch", "delete"].includes(method),
          )
          .map(
            ([method, definition]) =>
              `<div class="schema-row"><code>${esc(method.toUpperCase())} ${esc(path)}</code><span>${esc(definition.summary || "")}</span></div>`,
          ),
      )
      .join("");
    openDialog(
      "API reference",
      "The shared DynamoDB Tools API",
      `<p class="info-note">The installed service uses a private session. For external scripts, run the browser/server edition. Existing AWS write protections apply to every endpoint.</p>${endpoints}`,
      '<button class="button primary" type="button" data-action="close-dialog">Close reference</button>',
    );
  } catch (error) {
    toast(error.message, true);
  }
});

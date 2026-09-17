function connectionPresentation() {
  const c = state.overview.connection;
  const aws = c.mode === "aws";
  state.operations = state.overview.operations;
  document.getElementById("nav-table-count").textContent =
    state.overview.tables.length;
  document.getElementById("connection-status").textContent = "Connected";
  document.getElementById("connection-region").textContent = c.region;
  document.getElementById("connection-dot").classList.remove("offline");
  document.getElementById("last-sync").textContent =
    "Last synced " +
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  document.getElementById("workspace-name").textContent = aws
    ? "AWS workspace"
    : "Local workspace";
  document.getElementById("workspace-description").textContent = aws
    ? c.account
    : "Development environment";
  document.querySelector(".environment").innerHTML =
    `<span></span>${aws ? "AWS · " + (c.readOnly ? "READ ONLY" : "WRITES ENABLED") : "LOCAL DEVELOPMENT"}`;
  document.querySelector(".connection-card .version").textContent = aws
    ? "AWS"
    : "DEV";
  const notice = document.getElementById("cloud-notice");
  notice.hidden = !aws && !c.readOnly;
  notice.innerHTML = `${icon("database")}<div><strong>${aws ? `AWS account ${esc(c.account)} · ${esc(c.region)}` : "Local connection"} · ${c.readOnly ? "Read-only" : "Writes enabled"}</strong><p>${c.readOnly ? "Browse, query, and export. Changes are blocked by this server." : "Changes affect this AWS account. Your IAM permissions apply."} ${aws ? "Reads use AWS capacity. Automatic startup changes are disabled." : ""}</p></div>`;
  restrictWriteControls();
}
function restrictWriteControls() {
  if (!state.overview?.connection?.readOnly) return;
  const writes = new Set([
    "create-table",
    "add-item",
    "delete-item",
    "duplicate-item",
    "update-schema",
    "purge-table",
    "delete-table",
    "import-upload",
    "load-mounted",
    "delete-selected",
  ]);
  for (const button of document.querySelectorAll("[data-action]")) {
    if (writes.has(button.dataset.action)) {
      button.disabled = true;
      button.title = "This server connection is read-only";
    }
  }
  document
    .querySelectorAll(
      '#stream-config button[type="submit"], #ttl-form button[type="submit"]',
    )
    .forEach((b) => (b.disabled = true));
  if (dialogContext?.kind === "save-item") {
    const submit = document.querySelector('#dialog-form button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.title = "This server connection is read-only";
    }
  }
}
function observeConnectionControls() {
  const observer = new MutationObserver(restrictWriteControls);
  for (const node of [main, dialog])
    observer.observe(node, { childList: true, subtree: true });
}

async function renderConnectionForm(generation) {
  const data = await api("/api/connection");
  if (generation !== state.generation) return;
  const p = data.preferences;
  const host = document.createElement("section");
  host.className = "panel connection-editor";
  host.innerHTML = `<div class="panel-heading"><div><h2>Choose a connection</h2><p>Use your existing AWS sign-in or a local database.</p></div>${icon("database")}</div><form class="panel-body" id="connection-form"><div class="field-pair"><div class="field"><label for="connection-mode">Database</label><select id="connection-mode"><option value="aws">AWS account</option><option value="local">Local endpoint</option></select></div><div class="field"><label for="connection-access">Access mode</label><select id="connection-access"><option value="true">Read-only</option><option value="false">Allow writes</option></select></div></div><div class="field-pair" id="aws-connection-fields"><div class="field"><label for="connection-profile">AWS profile</label><input id="connection-profile" list="aws-profiles" placeholder="Default credential chain" value="${esc(p.aws_profile || "")}"><datalist id="aws-profiles">${data.profiles.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist><small>Blank uses AWS defaults: environment, ~/.aws, SSO, configured credential processes, or workload roles.</small></div><div class="field"><label for="connection-region-input">AWS region</label><input id="connection-region-input" placeholder="Default from AWS configuration" value="${esc(p.aws_region || "")}"></div></div><div class="field" id="local-connection-fields"><label for="connection-endpoint">Local endpoint</label><input id="connection-endpoint" value="${esc(p.dynamodb_endpoint_url)}"></div><p class="info-note">AWS credentials stay in your existing credential provider. For expired SSO sessions, sign in with the AWS CLI on this computer. Switching connections waits for active work to finish and clears session activity.</p><div class="button-group"><button type="button" id="test-connection" class="button">Test connection</button><button type="submit" class="button primary">Save & connect</button></div><p id="connection-feedback" role="status"></p><p class="info-note">Preferences are saved as JSON at <code>${esc(data.path)}</code>. No access keys or tokens are stored. Saved preferences override connection environment settings; startup mutations stay disabled for saved connections.</p></form>`;
  document.querySelector(".settings-grid").before(host);
  document.getElementById("connection-mode").value = p.dynamodb_mode;
  document.getElementById("connection-access").value = String(
    p.read_only ?? p.dynamodb_mode === "aws",
  );
  const fields = () => {
    const aws = document.getElementById("connection-mode").value === "aws";
    document
      .getElementById("aws-connection-fields")
      .classList.toggle("hidden", !aws);
    document
      .getElementById("local-connection-fields")
      .classList.toggle("hidden", aws);
  };
  fields();
  document.getElementById("connection-mode").onchange = () => {
    if (document.getElementById("connection-mode").value === "aws")
      document.getElementById("connection-access").value = "true";
    document.getElementById("connection-feedback").textContent = "";
    fields();
  };
  const run = async (save) => {
    const form = document.getElementById("connection-form");
    const feedback = document.getElementById("connection-feedback");
    const request = {
      dynamodb_mode: document.getElementById("connection-mode").value,
      aws_profile:
        document.getElementById("connection-profile").value.trim() || null,
      aws_region:
        document.getElementById("connection-region-input").value.trim() || null,
      dynamodb_endpoint_url: document
        .getElementById("connection-endpoint")
        .value.trim(),
      read_only: document.getElementById("connection-access").value === "true",
    };
    const controls = [...form.querySelectorAll("input,select,button")];
    controls.forEach((el) => (el.disabled = true));
    feedback.textContent = "Checking the connection…";
    try {
      const result = await send(
        save ? "/api/connection" : "/api/connection/test",
        save ? "PUT" : "POST",
        request,
      );
      feedback.textContent = `Connected · ${result.account ? "AWS account " + result.account : result.endpoint} · ${result.region} · ${result.readOnly ? "read-only" : "writes enabled"}`;
      if (save) location.reload();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      controls.forEach((el) => (el.disabled = false));
    }
  };
  document.getElementById("test-connection").onclick = () => run(false);
  document.getElementById("connection-form").onsubmit = (event) => {
    event.preventDefault();
    run(true);
  };
}

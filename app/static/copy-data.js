let copyDraft = null;
let copyBatches = [];
let selectedCopyBatch = "";
let copyPreview = null;
let copyRuleId = 0;

function copyFromItems() {
  copyDraft = {
    table: state.table,
    connection: state.overview.connection.id,
    query: readQueryForm(),
    transforms: [],
    maxItems: 100,
    maxPages: 10,
  };
  // Source selection always starts at the beginning, not the displayed page.
  copyDraft.query.cursor = null;
  location.hash = "copies";
}
function copyConnectionLabel(info) {
  return `${info.mode === "aws" ? "AWS " + info.account : info.endpoint} · ${info.region}`;
}
function copyCode(value) {
  return `<pre class="code-block" tabindex="0">${highlightJSON(JSON.stringify(value, null, 2))}</pre>`;
}
async function renderCopyData(generation = state.generation) {
  const batches = await api("/api/copies");
  if (generation !== state.generation) return;
  copyBatches = batches;
  copyPreview = null;
  if (copyDraft?.connection !== state.overview.connection.id)
    copyDraft = {
      table: "",
      connection: state.overview.connection.id,
      query: { mode: "scan", limit: 100 },
      transforms: [],
      maxItems: 100,
      maxPages: 10,
    };
  const options = state.overview.tables
    .map((t) => `<option value="${esc(t.TableName)}"></option>`)
    .join("");
  main.innerHTML = `<div class="page-heading"><div><p class="eyebrow">BETWEEN TABLES · BETWEEN CONNECTIONS</p><h1>Copy data</h1><p class="subtitle">Select a small dataset, reshape it, then review where it goes.</p></div></div><div class="info-banner"><strong>Source → staged batch → destination</strong><p>Capture from the current connection. To copy to another database, change the connection in <a href="#settings/connection">Settings</a>, then return here. Staged data stays in this service for 30 minutes; restarting the service discards it. Export a file to keep it.</p></div><datalist id="copy-tables">${options}</datalist><section class="panel mt"><div class="panel-heading"><div><h2>1. Prepare the source</h2><p>${esc(copyConnectionLabel(state.overview.connection))}</p></div>${icon("database")}</div><form id="copy-source-form" class="panel-body"><div class="copy-fields"><div class="field"><label for="copy-source-table">Source table</label><input id="copy-source-table" list="copy-tables" required pattern="[A-Za-z0-9_.-]{3,255}" value="${esc(copyDraft.table)}" placeholder="Choose or enter a table name"></div><div class="field"><label for="copy-max-items">Maximum matched items</label><input id="copy-max-items" type="number" min="1" max="1000" required value="${copyDraft.maxItems}"></div><div class="field"><label for="copy-max-pages">Maximum read pages</label><input id="copy-max-pages" type="number" min="1" max="20" required value="${copyDraft.maxPages}"></div></div><p class="info-note" id="copy-query-label"></p><p class="info-note">For filters, an index or a single-table access pattern, prepare it in <strong>Items</strong> or <strong>Query planner → Use in Items</strong>, then choose <strong>Copy matching data</strong>. Page filtering is not a database filter and is not copied.</p><details class="type-guide"><summary>Source query</summary><div id="copy-query-json"></div></details><h3>Transform attributes</h3><p class="info-note">Optional, applied in order to literal top-level names. Other types and fields are preserved. “Set / add” accepts a JSON value: quoted text, a number, true, null, an object or an array. No scripts.</p><div id="copy-rules"></div><button type="button" id="copy-add-rule" class="button small">${icon("plus")}Add transformation</button><p class="info-note">Capture reads at most the limits above or 10 MiB of transformed data. Index queries and projections fetch complete base-table items first. Reads consume capacity and are not a point-in-time snapshot. Timestamps are fixed once for the entire capture.</p><p id="copy-source-error" class="form-error" role="alert"></p><button class="button primary" type="submit">${icon("download")}Capture & preview</button></form></section><section class="panel mt"><div class="panel-heading"><div><h2>2. Review the staged batch</h2><p>These are the exact transformed items that will be copied.</p></div></div><div class="panel-body"><div class="field"><label for="copy-batch">Staged batch</label><select id="copy-batch"><option value="">Choose a batch…</option>${batches.map((b) => `<option value="${b.id}">${esc(b.source.table)} · ${b.count} items · ${esc(new Date(b.capturedAt).toLocaleTimeString())}</option>`).join("")}</select></div><div id="copy-batch-detail"></div></div></section><section class="panel mt"><div class="panel-heading"><div><h2>3. Choose the destination</h2><p>Current connection: ${esc(copyConnectionLabel(state.overview.connection))}</p></div></div><form class="panel-body" id="copy-destination-form"><p class="info-note">Copying to another database? <a href="#settings/connection">Switch connection</a> and return to Copy data. The source stays unchanged.</p><div class="copy-fields"><div class="field"><label for="copy-destination">Destination table</label><input id="copy-destination" list="copy-tables" required pattern="[A-Za-z0-9_.-]{3,255}" placeholder="Choose or enter an existing table"></div><div class="field"><label for="copy-policy">If the key already exists</label><select id="copy-policy"><option value="skip">Skip existing items (recommended)</option><option value="replace">Replace the entire existing item</option></select></div></div><p class="info-note">Skip uses a conditional write to protect existing items. Replace removes any old attributes absent from the copied item. Neither option merges fields.</p><button class="button" type="submit">Preview destination</button><p id="copy-destination-error" class="form-error" role="alert"></p></form><div id="copy-destination-preview" class="panel-body" hidden></div></section><section class="panel mt"><div class="panel-heading"><div><h2>Copy progress</h2><p>Stopping or a failure leaves earlier writes in place. A failed request may have an uncertain outcome. Reported WCU covers successful writes; conditional failures can also consume capacity.</p></div><a class="button small" href="#activity">Activity</a></div><div class="panel-body" id="copy-jobs"></div></section>`;
  copyDraft.transforms.forEach(addCopyRule);
  renderCopyQuery();
  const form = document.getElementById("copy-source-form");
  form.addEventListener("input", () => {
    const table = document.getElementById("copy-source-table").value;
    if (table !== copyDraft.table)
      copyDraft.query = { mode: "scan", limit: 100 };
    copyDraft.table = table;
    copyDraft.maxItems = Number(
      document.getElementById("copy-max-items").value,
    );
    copyDraft.maxPages = Number(
      document.getElementById("copy-max-pages").value,
    );
    copyDraft.transforms = readCopyRules();
    renderCopyQuery();
  });
  form.onsubmit = captureCopy;
  document.getElementById("copy-add-rule").onclick = () => addCopyRule();
  document.getElementById("copy-batch").onchange = (event) => {
    selectedCopyBatch = event.target.value;
    renderCopyBatch();
    invalidateCopyPreview();
  };
  if (!batches.some((b) => b.id === selectedCopyBatch))
    selectedCopyBatch = batches[0]?.id || "";
  document.getElementById("copy-batch").value = selectedCopyBatch;
  renderCopyBatch();
  document
    .getElementById("copy-destination-form")
    .addEventListener("input", invalidateCopyPreview);
  document.getElementById("copy-destination-form").onsubmit = previewCopy;
  renderCopyJobs(state.operations);
}
function renderCopyQuery() {
  const q = copyDraft.query;
  document.getElementById("copy-query-label").textContent =
    `${q.mode === "query" ? "Query" : "Scan"} · ${q.index || "Base table"} · starts ${q.cursor ? "at the continuation from the preceding capture" : "from the beginning"}`;
  document.getElementById("copy-query-json").innerHTML = copyCode(q);
}
function addCopyRule(rule = {}) {
  const host = document.getElementById("copy-rules");
  if (host.children.length >= 20) return;
  const id = ++copyRuleId;
  const row = document.createElement("div");
  row.className = "copy-rule";
  row.innerHTML = `<div class="field"><label for="copy-op-${id}">Change</label><select id="copy-op-${id}" class="copy-operation"><option value="remove">Remove attribute</option><option value="rename">Rename attribute</option><option value="set">Set / add value</option><option value="timestamp">Set timestamp</option></select></div><div class="field"><label for="copy-attr-${id}">Attribute name</label><input id="copy-attr-${id}" class="copy-attribute" required maxlength="255" value="${esc(rule.attribute || "")}"></div><div class="field copy-rename-field"><label for="copy-target-${id}">New name</label><input id="copy-target-${id}" class="copy-target" maxlength="255" value="${esc(rule.target || "")}"></div><div class="field copy-value-field"><label for="copy-value-${id}">JSON value</label><textarea id="copy-value-${id}" class="copy-value" rows="2" maxlength="65536" placeholder='"example"'>${esc(rule.value || "")}</textarea></div><div class="field copy-time-field"><label for="copy-time-${id}">Timestamp format</label><select id="copy-time-${id}" class="copy-time"><option value="iso">UTC ISO string</option><option value="seconds">Epoch seconds · number</option><option value="milliseconds">Epoch milliseconds · number</option></select></div><button class="icon-button" type="button" aria-label="Remove transformation ${id}">${icon("close")}</button>`;
  row.querySelector(".copy-operation").value = rule.operation || "remove";
  row.querySelector(".copy-time").value = rule.format || "iso";
  const update = () => {
    const op = row.querySelector(".copy-operation").value;
    row.querySelector(".copy-rename-field").hidden = op !== "rename";
    row.querySelector(".copy-value-field").hidden = op !== "set";
    row.querySelector(".copy-time-field").hidden = op !== "timestamp";
    row.querySelector(".copy-target").required = op === "rename";
    row.querySelector(".copy-value").required = op === "set";
  };
  row.querySelector(".copy-operation").onchange = update;
  row.querySelector("button").onclick = () => {
    row.remove();
    copyDraft.transforms = readCopyRules();
  };
  update();
  host.append(row);
}
function readCopyRules() {
  return [...document.querySelectorAll(".copy-rule")].map((row) => ({
    operation: row.querySelector(".copy-operation").value,
    attribute: row.querySelector(".copy-attribute").value,
    target: row.querySelector(".copy-target").value,
    value: row.querySelector(".copy-value").value,
    format: row.querySelector(".copy-time").value,
  }));
}
async function captureCopy(event) {
  event.preventDefault();
  const generation = state.generation;
  const controls = [
    ...event.target.querySelectorAll("button,input,select,textarea"),
  ];
  const error = document.getElementById("copy-source-error");
  error.textContent = "Reading the source and transforming the batch…";
  controls.forEach((el) => (el.disabled = true));
  try {
    const batch = await send(
      tablePath(copyDraft.table) + "/copies/capture",
      "POST",
      {
        query: copyDraft.query,
        transforms: readCopyRules(),
        maxItems: copyDraft.maxItems,
        maxPages: copyDraft.maxPages,
      },
    );
    selectedCopyBatch = batch.id;
    if (generation === state.generation) await renderCopyData(generation);
    else
      toast(
        `Copy batch ready · ${batch.count} items. Open Copy data to review.`,
      );
  } catch (e) {
    error.textContent = e.message;
  } finally {
    controls.forEach((el) => (el.disabled = false));
  }
}
function renderCopyBatch() {
  const host = document.getElementById("copy-batch-detail");
  const b = copyBatches.find((b) => b.id === selectedCopyBatch);
  if (!b) {
    host.innerHTML =
      '<p class="info-note">Capture a query or scan above to prepare a batch.</p>';
    return;
  }
  host.innerHTML = `<div class="copy-summary"><strong>${fmt(b.count)} items</strong><span>${bytes(b.bytes)} JSON</span><span>${fmt(b.evaluated)} evaluated</span><span>${b.capacity} RCU</span></div><p class="info-note">Source: <strong>${esc(b.source.table)}</strong> · ${esc(copyConnectionLabel(b.source.connection))}<br>Captured ${esc(new Date(b.capturedAt).toLocaleString())} · expires ${esc(new Date(b.expiresAt).toLocaleTimeString())}</p><p class="${b.complete ? "info-note" : "error-banner"}">${b.complete ? "Reached the end of this selection." : "Partial selection: a read limit was reached. More matching items may remain; this batch is not the whole selection."}${b.missing ? ` ${b.missing} items disappeared before the full item could be read.` : ""}</p><div class="button-group"><button type="button" class="button small" id="copy-export">Export transformed JSON</button><button type="button" class="button small" id="copy-discard">Discard staged batch</button>${!b.complete && b.source.connection.id === state.overview.connection.id ? '<button type="button" class="button small" id="copy-next">Prepare next batch</button>' : ""}</div><details class="type-guide"><summary>Before and after · first ${Math.min(3, b.count)} items</summary><div class="copy-samples"><div><h3>Source</h3>${copyCode(b.before)}</div><div><h3>After transformations</h3>${copyCode(b.after)}</div></div></details><details class="type-guide"><summary>Transformations applied</summary>${copyCode(b.transforms)}</details>`;
  document.getElementById("copy-export").onclick = async () => {
    try {
      await saveDownload(
        JSON.stringify(await api(`/api/copies/${b.id}/export`), null, 2),
        b.source.table + "-copy.dynamodb.json",
      );
    } catch (e) {
      toast(e.message, true);
    }
  };
  document.getElementById("copy-discard").onclick = async () => {
    try {
      await send(`/api/copies/${b.id}/discard`, "POST", {});
      await renderCopyData();
    } catch (e) {
      toast(e.message, true);
    }
  };
  const next = document.getElementById("copy-next");
  if (next)
    next.onclick = () => {
      copyDraft = {
        table: b.source.table,
        connection: state.overview.connection.id,
        query: { ...b.source.query, cursor: b.cursor },
        transforms: b.transforms,
        maxItems: copyDraft.maxItems || 100,
        maxPages: copyDraft.maxPages || 10,
      };
      renderCopyData().catch((e) => toast(e.message, true));
    };
}
function invalidateCopyPreview() {
  copyPreview = null;
  const host = document.getElementById("copy-destination-preview");
  host.hidden = true;
  host.innerHTML = "";
}
async function previewCopy(event) {
  event.preventDefault();
  invalidateCopyPreview();
  const generation = state.generation;
  const table = document.getElementById("copy-destination").value;
  const policy = document.getElementById("copy-policy").value;
  const batch = selectedCopyBatch;
  const error = document.getElementById("copy-destination-error");
  error.textContent = "Checking all staged items against the destination…";
  try {
    const preview = await send(tablePath(table) + "/copies/preview", "POST", {
      batch,
      policy,
    });
    if (
      generation !== state.generation ||
      table !== document.getElementById("copy-destination").value ||
      policy !== document.getElementById("copy-policy").value ||
      batch !== selectedCopyBatch
    )
      return;
    copyPreview = preview;
    error.textContent = "";
    const host = document.getElementById("copy-destination-preview");
    host.hidden = false;
    host.innerHTML = `<div class="${policy === "replace" ? "error-banner" : "info-banner"}"><strong>${preview.count} items → ${esc(table)}</strong><p>${esc(copyConnectionLabel(preview.destination.connection))}<br>${policy === "replace" ? "Replace mode: an existing item with the same key will be completely replaced." : "Skip mode: existing keys will be preserved, including items written after this preview."}</p></div><p class="info-note">All ${preview.count} items passed destination key and index checks. Collision counts are determined during conditional writes, not guessed from a preview. Review expires in five minutes.</p><form id="copy-confirm-form"><div class="field"><label for="copy-confirm">Type <strong>COPY ${esc(table)}</strong> to confirm</label><input id="copy-confirm" autocomplete="off" required></div><p class="info-note">${state.overview.connection.readOnly ? "This destination is read-only. Enable writes in Settings, then preview again." : "The source will not be modified. AWS destinations require an additional account, region and target confirmation."}</p><button class="button ${policy === "replace" ? "danger" : "primary"}" type="submit" id="execute-copy" ${state.overview.connection.readOnly ? "disabled" : ""}>Copy reviewed batch</button><p class="form-error" id="copy-execute-error" role="alert"></p></form>`;
    document.getElementById("copy-confirm-form").onsubmit = executeCopy;
  } catch (e) {
    error.textContent = e.message;
  }
}
async function executeCopy(event) {
  event.preventDefault();
  const preview = copyPreview;
  if (!preview) return;
  const button = document.getElementById("execute-copy");
  const error = document.getElementById("copy-execute-error");
  button.disabled = true;
  error.textContent = "";
  try {
    const job = await send(
      tablePath(preview.destination.table) + "/copies/execute",
      "POST",
      {
        token: preview.token,
        confirmation: document.getElementById("copy-confirm").value,
      },
    );
    invalidateCopyPreview();
    state.operations = [
      job,
      ...state.operations.filter((o) => o.id !== job.id),
    ];
    if (state.route === "copies") renderCopyJobs(state.operations);
    toast("Copy queued. Progress appears below and in Activity.");
  } catch (e) {
    error.textContent = e.message;
    button.disabled = !!state.overview.connection.readOnly;
  }
}
function renderCopyJobs(jobs) {
  const host = document.getElementById("copy-jobs");
  if (!host) return;
  const copies = jobs.filter((j) => j.action === "Copy data");
  host.innerHTML = copies.length
    ? copies
        .map(
          (j) =>
            `<div class="copy-job"><div><strong>${esc(j.table)}</strong> ${statusTag(j.status)}<p>${esc(j.detail || "Waiting to start…")}</p></div>${["queued", "running"].includes(j.status) ? `<button type="button" class="button small" data-stop-copy="${j.id}">Stop after current item</button>` : ""}</div>`,
        )
        .join("")
    : '<p class="info-note">No copies have run in this connection session.</p>';
  host.querySelectorAll("[data-stop-copy]").forEach(
    (button) =>
      (button.onclick = async () => {
        button.disabled = true;
        try {
          await send(
            `/api/copies/jobs/${button.dataset.stopCopy}/stop`,
            "POST",
            {},
          );
          toast("Stop requested. Earlier writes remain.");
        } catch (e) {
          toast(e.message, true);
          button.disabled = false;
        }
      }),
  );
}

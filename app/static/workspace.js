"use strict";
const filterOperators = {
  "=": "Equals",
  "<>": "Not equal",
  "<": "Less than",
  "<=": "At most",
  ">": "Greater than",
  ">=": "At least",
  contains: "Contains",
  begins_with: "Begins with",
  between: "Between",
  exists: "Exists",
  not_exists: "Does not exist",
  attribute_type: "Has type",
};
let filterId = 0;
function renderReadOptions() {
  const q = state.search;
  document.getElementById("read-options").innerHTML =
    `<details ${q.filters?.length || q.filterExpression || q.projection?.length || q.consistent ? "open" : ""}><summary>Filters & read options</summary><div class="read-options-body"><div class="field-pair"><div class="field"><label for="filter-mode">Filter mode</label><select id="filter-mode"><option value="builder">Filter builder</option><option value="expression">Expression</option></select></div><div class="field"><label for="filter-join">Match</label><select id="filter-join"><option value="AND">All conditions</option><option value="OR">Any condition</option></select></div></div><div id="filter-builder"><div id="filter-rows"></div><button type="button" class="button small" data-action="add-filter">${icon("plus")}Add filter</button></div><div id="filter-expression-fields" class="hidden"><div class="field"><label for="filter-expression">Filter expression</label><input id="filter-expression" placeholder="contains(#name, :value)"></div><div class="field-pair"><div class="field"><label for="filter-names">Attribute names (JSON)</label><textarea id="filter-names" rows="3" spellcheck="false">${esc(JSON.stringify(q.expressionNames || {}, null, 2))}</textarea></div><div class="field"><label for="filter-values">Attribute values (DynamoDB JSON)</label><textarea id="filter-values" rows="3" spellcheck="false">${esc(JSON.stringify(q.expressionValues || {}, null, 2))}</textarea></div></div><p class="editor-help">Use aliases for reserved names and nested paths, for example #address.#city = :city. Values use DynamoDB types.</p></div><div class="field"><label for="query-projection">Returned attributes (one name per line, optional)</label><textarea id="query-projection" rows="2" placeholder="Leave empty for all attributes">${esc((q.projection || []).join("\n"))}</textarea><small>Names are literal, including dots. Primary keys are always included. Opening an item fetches its full record.</small></div><label class="checkbox-label"><input type="checkbox" id="query-consistent" ${q.consistent ? "checked" : ""}>Strongly consistent read (table or local index only)</label><p class="info-note">Server filters apply after each read and do not reduce read capacity. Page size counts evaluated items, so a page can be empty with more results ahead. Query key conditions belong in the key fields above.</p></div></details>`;
  document.getElementById("filter-mode").value = q.filterExpression
    ? "expression"
    : "builder";
  document.getElementById("filter-join").value = q.filterJoin || "AND";
  document.getElementById("filter-expression").value = q.filterExpression || "";
  const change = () => {
    const advanced =
      document.getElementById("filter-mode").value === "expression";
    document
      .getElementById("filter-builder")
      .classList.toggle("hidden", advanced);
    document
      .getElementById("filter-expression-fields")
      .classList.toggle("hidden", !advanced);
    document.getElementById("filter-join").disabled = advanced;
  };
  document.getElementById("filter-mode").onchange = change;
  change();
  (q.filters || []).forEach(addFilterRow);
}
function addFilterRow(rule = {}) {
  const id = ++filterId;
  const row = document.createElement("div");
  row.className = "filter-row";
  row.innerHTML = `<div class="field"><label for="filter-attr-${id}">Attribute</label><input id="filter-attr-${id}" class="filter-attribute" placeholder="e.g. status" value="${esc(rule.attribute || "")}"></div><div class="field"><label for="filter-op-${id}">Condition</label><select id="filter-op-${id}" class="filter-operator">${Object.entries(
    filterOperators,
  )
    .map(([value, label]) => `<option value="${esc(value)}">${label}</option>`)
    .join(
      "",
    )}</select></div><div class="field filter-value-group"><label for="filter-type-${id}">Value type</label><select id="filter-type-${id}" class="filter-type">${["S", "N", "BOOL", "NULL", "B", "SS", "NS", "BS", "M", "L"].map((t) => `<option>${t}</option>`).join("")}</select></div><div class="field filter-value-group"><label for="filter-value-${id}">Value</label><input id="filter-value-${id}" class="filter-value" placeholder="Filter value"></div><div class="field filter-end-group"><label for="filter-end-${id}">Range end</label><input id="filter-end-${id}" class="filter-end" placeholder="Inclusive end"></div><button type="button" class="icon-button" data-action="remove-filter" aria-label="Remove filter ${id}">${icon("close")}</button>`;
  row.querySelector(".filter-operator").value = rule.operator || "=";
  const type = rule.value ? Object.keys(rule.value)[0] : "S";
  row.querySelector(".filter-type").value = type;
  const display = (attribute) =>
    !attribute
      ? ""
      : ["S", "N", "B"].includes(Object.keys(attribute)[0])
        ? Object.values(attribute)[0]
        : JSON.stringify(Object.values(attribute)[0]);
  row.querySelector(".filter-value").value = display(rule.value);
  row.querySelector(".filter-end").value = display(rule.end);
  const update = () => {
    const op = row.querySelector(".filter-operator").value;
    row
      .querySelectorAll(".filter-value-group")
      .forEach((el) =>
        el.classList.toggle("hidden", ["exists", "not_exists"].includes(op)),
      );
    row
      .querySelector(".filter-end-group")
      .classList.toggle("hidden", op !== "between");
  };
  row.querySelector(".filter-operator").onchange = update;
  update();
  document.getElementById("filter-rows").append(row);
}
function readOptions() {
  const result = {
    filters: [],
    filterJoin: document.getElementById("filter-join").value,
    projection: document
      .getElementById("query-projection")
      .value.split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    consistent: document.getElementById("query-consistent").checked,
  };
  if (document.getElementById("filter-mode").value === "expression") {
    result.filterExpression = document
      .getElementById("filter-expression")
      .value.trim();
    result.expressionNames = JSON.parse(
      document.getElementById("filter-names").value,
    );
    result.expressionValues = JSON.parse(
      document.getElementById("filter-values").value,
    );
  } else {
    for (const row of document.querySelectorAll(".filter-row")) {
      const attribute = row.querySelector(".filter-attribute").value;
      if (!attribute)
        throw new Error("Enter an attribute name for every filter.");
      const operator = row.querySelector(".filter-operator").value;
      const type = row.querySelector(".filter-type").value;
      const typed = (raw) => ({
        [type]: ["S", "N", "B"].includes(type) ? raw : JSON.parse(raw),
      });
      const rule = { attribute, operator };
      if (!["exists", "not_exists"].includes(operator))
        rule.value = typed(row.querySelector(".filter-value").value);
      if (operator === "between")
        rule.end = typed(row.querySelector(".filter-end").value);
      result.filters.push(rule);
    }
  }
  return result;
}
function resetSelection() {
  document.getElementById("selection-count").textContent =
    "Select items to act on this page";
  document.getElementById("delete-selected").disabled = true;
}
function selectedKeys() {
  return [...document.querySelectorAll(".item-selection:checked")].map((el) =>
    keyOf(state.items[Number(el.dataset.row)]),
  );
}
function bindSelection() {
  const all = document.getElementById("select-page");
  const boxes = [...document.querySelectorAll(".item-selection")];
  const update = () => {
    const count = boxes.filter((el) => el.checked).length;
    document.getElementById("selection-count").textContent =
      `${count} selected on this page`;
    document.getElementById("delete-selected").disabled =
      !count || state.overview.connection.readOnly;
    all.checked = count === boxes.length;
    all.indeterminate = count > 0 && count < boxes.length;
  };
  all.onchange = () => {
    boxes.forEach((el) => (el.checked = all.checked));
    update();
  };
  boxes.forEach((el) => (el.onchange = update));
}
function downloadJSON(value, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let streamState = null;
async function renderStreams() {
  const generation = state.generation,
    name = state.table;
  const data = await api(tablePath(name) + "/streams");
  if (generation !== state.generation || state.detailTab !== "streams") return;
  streamState = { name, cursor: null, records: [], request: null };
  document.getElementById("detail-content").innerHTML =
    `<section class="panel"><div class="panel-heading"><div><h2>Change data capture</h2><p>Inspect item changes through DynamoDB Streams.</p></div>${statusTag(data.specification.StreamEnabled ? "ENABLED" : "DISABLED")}</div><div class="panel-body"><form id="stream-config" class="workspace-form"><div class="field"><label for="stream-enabled">Capture changes</label><select id="stream-enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></div><div class="field"><label for="stream-view">Record contents</label><select id="stream-view"><option value="NEW_AND_OLD_IMAGES">Before and after images</option><option value="NEW_IMAGE">New image</option><option value="OLD_IMAGE">Old image</option><option value="KEYS_ONLY">Keys only</option></select></div><button class="button primary" type="submit">Apply stream settings</button><p class="info-note">Capture starts when Streams is enabled. Changing an enabled stream's view requires disabling it first, then enabling the new view. Reading does not consume or delete records.</p></form></div></section><section class="panel mt"><div class="panel-heading"><h2>Stream explorer</h2>${button("Refresh streams", "refresh-streams", "refresh", "small")}</div><div class="panel-body"><form id="stream-read-form" class="workspace-form"><div class="field wide-field"><label for="stream-arn">Stream</label><select id="stream-arn"><option value="">Choose a stream…</option>${data.streams.map((s) => `<option value="${esc(s.StreamArn)}">${esc(s.StreamLabel || s.StreamArn)}${s.StreamArn === data.latestArn ? " · latest" : ""}</option>`).join("")}</select></div><div class="field wide-field"><label for="stream-shard">Shard</label><select id="stream-shard"><option value="">Choose a stream first</option></select></div><div class="field"><label for="stream-start">Start reading</label><select id="stream-start"><option value="TRIM_HORIZON">Oldest available</option><option value="LATEST">From now</option><option value="AT_SEQUENCE_NUMBER">At sequence number</option><option value="AFTER_SEQUENCE_NUMBER">After sequence number</option></select></div><div class="field"><label for="stream-sequence">Sequence number (when required)</label><input id="stream-sequence" placeholder="Exact sequence number"></div><button class="button primary" type="submit">Read records</button></form><p class="info-note">Each read returns up to 50 records from one shard. Empty pages can still have a continuation. Use Read next for new changes. Expired positions require starting again.</p><p id="stream-info" role="status"></p><div id="stream-records">${empty("Follow your data's changes", data.streams.length ? "Choose a shard and read its records." : "Enable Streams, then write an item to see changes.", "", true)}</div><div class="button-group mt"><button type="button" class="button" data-action="stream-next" id="stream-next" disabled>Read next</button><button type="button" class="button" data-action="stream-export" id="stream-export" disabled>Export this read</button></div></div></section>`;
  document.getElementById("stream-enabled").value = String(
    data.specification.StreamEnabled,
  );
  document.getElementById("stream-view").value =
    data.specification.StreamViewType || "NEW_AND_OLD_IMAGES";
  document.getElementById("stream-config").onsubmit = async (event) => {
    event.preventDefault();
    await formOperation(event.currentTarget, () =>
      send(tablePath(name) + "/streams", "PUT", {
        enabled: document.getElementById("stream-enabled").value === "true",
        view: document.getElementById("stream-view").value,
      }),
    );
  };
  document.getElementById("stream-arn").onchange = () =>
    loadShards().catch((e) => toast(e.message, true));
  document
    .getElementById("stream-read-form")
    .addEventListener("change", (event) => {
      if (event.target.id === "stream-arn") return;
      streamState.cursor = null;
      streamState.request = null;
      document.getElementById("stream-next").disabled = true;
    });
  document.getElementById("stream-read-form").onsubmit = (event) => {
    event.preventDefault();
    readStream(false).catch((e) => toast(e.message, true));
  };
  if (data.streams.length) {
    document.getElementById("stream-arn").value =
      data.latestArn || data.streams[0].StreamArn;
    await loadShards();
  }
}
async function loadShards() {
  const current = streamState,
    arn = document.getElementById("stream-arn").value;
  current.cursor = null;
  current.records = [];
  current.request = null;
  document.getElementById("stream-next").disabled = true;
  document.getElementById("stream-export").disabled = true;
  document.getElementById("stream-records").innerHTML = "";
  document.getElementById("stream-shard").innerHTML =
    '<option value="">Loading shards…</option>';
  if (!arn) return;
  const data = await api(
    tablePath(current.name) + "/streams/shards?arn=" + encodeURIComponent(arn),
  );
  if (
    streamState !== current ||
    state.detailTab !== "streams" ||
    document.getElementById("stream-arn").value !== arn
  )
    return;
  document.getElementById("stream-shard").innerHTML = data.shards.length
    ? data.shards
        .map(
          (s) =>
            `<option value="${esc(s.ShardId)}">${esc(s.ShardId)}${s.SequenceNumberRange.EndingSequenceNumber ? " · closed" : ""}</option>`,
        )
        .join("")
    : '<option value="">No shards yet — refresh after a write</option>';
  document.getElementById("stream-info").textContent =
    `${data.status} · ${data.view} · ${data.shards.length} shards`;
}
async function readStream(next) {
  const current = streamState;
  if (current.busy) return;
  const request = next
    ? { ...current.request, cursor: current.cursor }
    : {
        arn: document.getElementById("stream-arn").value,
        shard: document.getElementById("stream-shard").value,
        start: document.getElementById("stream-start").value,
        sequence: document.getElementById("stream-sequence").value,
      };
  if (!request.arn || !request.shard)
    throw new Error("Choose a stream and shard first.");
  current.busy = true;
  const controls = [
    ...document.querySelectorAll(
      "#stream-read-form input, #stream-read-form select",
    ),
  ];
  controls.forEach((el) => (el.disabled = true));
  const button = document.querySelector("#stream-read-form button");
  button.disabled = true;
  document.getElementById("stream-next").disabled = true;
  try {
    const result = await send(
      tablePath(current.name) + "/streams/records",
      "POST",
      request,
    );
    if (streamState !== current || state.detailTab !== "streams") return;
    current.request = request;
    current.cursor = result.cursor;
    current.records = result.records;
    document.getElementById("stream-info").textContent =
      `${result.records.length} records · ${result.cursor ? "More reads available" : "End of shard"}`;
    document.getElementById("stream-records").innerHTML = result.records.length
      ? result.records
          .map(
            (r) =>
              `<details class="stream-record"><summary><span class="tag">${esc(r.eventName)}</span><span>${esc(
                Object.values(r.dynamodb.Keys || {})
                  .map(attrDisplay)
                  .join(" / "),
              )}</span><small>${esc(r.dynamodb.SequenceNumber)}</small></summary><div class="stream-images">${[
                "Keys",
                "OldImage",
                "NewImage",
              ]
                .filter((key) => r.dynamodb[key])
                .map(
                  (key) =>
                    `<div><h3>${key === "OldImage" ? "Before" : key === "NewImage" ? "After" : "Keys"}</h3><pre class="code-block" tabindex="0">${esc(JSON.stringify(r.dynamodb[key], null, 2))}</pre></div>`,
                )
                .join("")}</div></details>`,
          )
          .join("")
      : empty(
          "No records in this read",
          "Read next to continue, or write an item to produce a new event.",
          "",
          true,
        );
    document.getElementById("stream-next").disabled = !result.cursor;
    document.getElementById("stream-export").disabled = !result.records.length;
  } catch (error) {
    current.cursor = null;
    throw new Error(
      error.message + " Start reading again if the position has expired.",
    );
  } finally {
    current.busy = false;
    button.disabled = false;
    controls.forEach((el) => (el.disabled = false));
  }
}
async function formOperation(form, action) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    startedOperation(await action());
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}
async function renderTTL(content, generation) {
  const name = state.table;
  const section = document.createElement("section");
  section.className = "panel mt";
  section.innerHTML =
    '<div class="panel-heading"><h2>Time to live (TTL)</h2></div><div class="panel-body" id="ttl-settings">Loading TTL settings…</div>';
  content.prepend(section);
  try {
    const data = await api(tablePath(name) + "/ttl");
    if (generation !== state.generation || state.detailTab !== "manage") return;
    document.getElementById("ttl-settings").innerHTML =
      `<p class="info-note">Current status: <strong>${esc(data.TimeToLiveStatus)}</strong>. TTL values are Unix timestamps in seconds stored as numbers. The local emulator may accept configuration without deleting expired items automatically.</p><form id="ttl-form" class="workspace-form"><div class="field"><label for="ttl-enabled">Expiration</label><select id="ttl-enabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></div><div class="field"><label for="ttl-attribute">TTL attribute</label><input id="ttl-attribute" required value="${esc(data.AttributeName || "expires_at")}"></div><button class="button primary" type="submit">Apply TTL settings</button></form><p class="info-note">Disable the current TTL attribute before choosing a different one. Reopen this tab to refresh its status.</p>`;
    document.getElementById("ttl-enabled").value = String(
      ["ENABLED", "ENABLING"].includes(data.TimeToLiveStatus),
    );
    document.getElementById("ttl-form").onsubmit = async (event) => {
      event.preventDefault();
      await formOperation(event.currentTarget, () =>
        send(tablePath(name) + "/ttl", "PUT", {
          enabled: document.getElementById("ttl-enabled").value === "true",
          attribute: document.getElementById("ttl-attribute").value,
        }),
      );
    };
  } catch (error) {
    if (section.isConnected)
      section.querySelector(".panel-body").textContent = error.message;
  }
}
let partiqlState = null;
function renderPartiQL() {
  partiqlState = { table: state.table, cursor: null, request: null, items: [] };
  document.getElementById("detail-content").innerHTML =
    `<section class="panel"><div class="panel-heading"><div><h2>PartiQL workbench</h2><p>Query or change data using DynamoDB's SQL-compatible language.</p></div></div><div class="panel-body"><form id="partiql-form"><div class="field"><label for="partiql-statement">Statement</label><textarea id="partiql-statement" spellcheck="false" rows="6">${esc('SELECT * FROM "' + state.table.replaceAll('"', '""') + '"')}</textarea></div><div class="field mt"><label for="partiql-parameters">Parameters (DynamoDB JSON array)</label><textarea id="partiql-parameters" rows="2" spellcheck="false">[]</textarea><small>Use ? placeholders. For example: [{"S":"orders"}]. Numbers are strings in DynamoDB JSON.</small></div><label class="checkbox-label mt"><input type="checkbox" id="partiql-consistent">Strongly consistent read</label><div class="button-group mt"><button class="button primary" type="submit">${icon("play")}Run statement</button><button class="button" type="button" id="partiql-next" data-action="partiql-next" disabled>Next results</button><button class="button" type="button" id="partiql-export" data-action="partiql-export" disabled>Export results page</button></div><p class="info-note">SELECT reads data. INSERT, UPDATE, and DELETE require confirmation. Statements can target any table in this connection. Results are paginated by DynamoDB; this is not a multi-statement SQL session.</p></form><p id="partiql-status" role="status"></p><div id="partiql-results"></div></div></section>`;
  document.getElementById("partiql-form").addEventListener("input", () => {
    partiqlState.cursor = null;
    document.getElementById("partiql-next").disabled = true;
  });
  document.getElementById("partiql-form").onsubmit = async (event) => {
    event.preventDefault();
    try {
      const request = {
        statement: document.getElementById("partiql-statement").value,
        parameters: JSON.parse(
          document.getElementById("partiql-parameters").value,
        ),
        consistent: document.getElementById("partiql-consistent").checked,
      };
      if (!/^\s*SELECT\b/i.test(request.statement))
        openDialog(
          "Run this write statement?",
          "Review the statement before changing data.",
          `<pre class="code-block" tabindex="0">${esc(request.statement)}</pre><p class="editor-help">This can create, replace, or delete data in the table named in your statement.</p>`,
          '<button type="submit" class="button danger">Run write</button>',
          { kind: "partiql-write", request, workspace: partiqlState },
        );
      else await runPartiQL(request);
    } catch (error) {
      toast(error.message, true);
    }
  };
}
async function runPartiQL(request) {
  const current = partiqlState;
  if (current.busy) return;
  current.busy = true;
  const controls = [
    ...document.querySelectorAll("#partiql-form textarea, #partiql-form input"),
  ];
  controls.forEach((el) => (el.disabled = true));
  const button = document.querySelector("#partiql-form button[type=submit]");
  button.disabled = true;
  document.getElementById("partiql-next").disabled = true;
  try {
    const result = await send("/api/partiql", "POST", request);
    if (current !== partiqlState || state.detailTab !== "partiql") return;
    current.request = { ...request, cursor: null };
    current.cursor = result.cursor;
    current.items = result.items;
    document.getElementById("partiql-next").disabled = !result.cursor;
    document.getElementById("partiql-export").disabled = !result.items.length;
    document.getElementById("partiql-status").textContent =
      `${result.write ? "Write completed" : `${result.items.length} items returned · ${bytes(result.returnedBytes)} (est.)`} · ${result.capacity} capacity units${result.lastEvaluatedKey && !result.cursor ? " · DynamoDB returned a partial result without a continuation token. Narrow your WHERE clause to continue." : ""}`;
    document.getElementById("partiql-results").innerHTML =
      `<pre class="code-block" tabindex="0">${highlightJSON(JSON.stringify(result.items, null, 2))}</pre>`;
  } finally {
    current.busy = false;
    button.disabled = false;
    controls.forEach((el) => (el.disabled = false));
  }
}
async function submitWorkspaceDialog(context) {
  if (context.kind === "bulk-delete") {
    const confirmation = document.getElementById("confirmation").value;
    await send(tablePath(context.table) + "/items/delete-selected", "POST", {
      keys: context.keys,
      confirmation,
    });
    dialog.close();
    toast(`${context.keys.length} items deleted.`);
    if (state.table === context.table && state.detailTab === "items")
      await loadItems();
    await refreshOperations();
    return true;
  }
  if (context.kind === "partiql-write") {
    if (partiqlState !== context.workspace)
      throw new Error("Reopen the workbench before running this statement.");
    await runPartiQL({ ...context.request, allowWrite: true });
    dialog.close();
    await refreshOperations();
    return true;
  }
  return false;
}
async function workspaceAction(name, target) {
  if (name === "add-filter") addFilterRow();
  else if (name === "remove-filter") target.closest(".filter-row").remove();
  else if (name === "delete-selected") {
    const keys = selectedKeys();
    if (!keys.length) return true;
    openDialog(
      `Delete ${keys.length} selected items?`,
      "All selected items are deleted together, or none are changed.",
      `<p class="editor-help">This permanently deletes the selected records. Other items are unaffected.</p><div class="field"><label for="confirmation">Type ${esc(state.table)} to confirm</label><input id="confirmation" required autocomplete="off"></div>`,
      '<button type="submit" class="button danger">Delete selected items</button>',
      { kind: "bulk-delete", table: state.table, keys },
    );
  } else if (name === "export-page") {
    const rows = [...document.querySelectorAll(".item-selection")].map(
      (el) => state.items[Number(el.dataset.row)],
    );
    downloadJSON(rows, state.table + ".page.dynamodb.json");
    toast("Visible page exported with its displayed attributes.");
  } else if (name === "refresh-streams") await renderStreams();
  else if (name === "stream-next") await readStream(true);
  else if (name === "stream-export")
    downloadJSON(streamState.records, state.table + ".stream.json");
  else if (name === "partiql-next")
    await runPartiQL({ ...partiqlState.request, cursor: partiqlState.cursor });
  else if (name === "partiql-export")
    downloadJSON(partiqlState.items, state.table + ".partiql.dynamodb.json");
  else return false;
  return true;
}

"use strict";
const paths = {
  database:
    "M20 6c0 2-3.6 3.5-8 3.5S4 8 4 6s3.6-3.5 8-3.5S20 4 20 6ZM4 6v6c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5V6M4 12v6c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5v-6",
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  table: "M3 4h18v16H3zM3 9h18M3 14h18M9 9v11",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  download: "M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5",
  activity: "m2 12 5 0 3-8 4 16 3-8h5",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3 1v4l-2 2-1 3 0 3-4 2-3-1-3-1-3-1-1-4 1-3 1-3 0-3 4-1Z",
  external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
  refresh: "M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5",
  plus: "M12 5v14M5 12h14",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M16 16l5 5",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  left: "M19 12H5m5-5-5 5 5 5",
  chevron: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M18 6 6 18",
  file: "M14 2H5v20h14V7l-5-5v5h5M8 12h8M8 16h5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 2",
  key: "M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10m3.5 8.5L21 21m-4-4 3-3",
  layers: "m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5",
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 8v6m0-10v.1",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  edit: "m15 4 5 5M4 16 16 4a3 3 0 0 1 4 4L8 20l-5 1Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  play: "m8 4 12 8-12 8Z",
  storage: "M3 4h18v16H3zM7 8h10M7 12h7M7 16h3",
  alert: "m12 3 10 18H2Zm0 5v6m0 3v.1",
  bookmark: "M6 3h12v18l-6-4-6 4Z",
  copy: "M9 9h12v12H9zM15 9V3H3v12h6",
};
const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.table}"/></svg>`;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const fmt = (number) => new Intl.NumberFormat().format(number || 0);
const bytes = (number) =>
  number < 1024
    ? `${fmt(number)} B`
    : number < 1048576
      ? `${(number / 1024).toFixed(1)} KB`
      : `${(number / 1048576).toFixed(1)} MB`;
const tablePath = (name) => "/api/tables/" + encodeURIComponent(name);
const tableHash = (name) => "#tables/" + encodeURIComponent(name);
const button = (text, action, name = "plus", cls = "", data = "") =>
  `<button class="button ${cls}" data-action="${action}" ${data}>${icon(name)}${text}</button>`;
const empty = (title, description, action = "", compact = false) =>
  `<div class="empty ${compact ? "compact" : ""}"><span class="empty-icon">${icon("database")}</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
const state = {
  overview: null,
  operations: [],
  route: "overview",
  table: null,
  detailTab: "items",
  detail: null,
  generation: 0,
  items: [],
  page: 1,
  cursors: [null],
  nextCursor: null,
  search: { mode: "scan", index: null, limit: 25 },
  savedQueryId: "",
  busy: false,
  importFile: null,
  importTable: null,
};
const main = document.getElementById("main");
const dialog = document.getElementById("dialog");
let dialogContext = null;
let refreshPromise = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    let data;
    try {
      data = await response.json();
    } catch {
      data = { detail: response.statusText };
    }
    const detail = Array.isArray(data.detail)
      ? data.detail
          .map((e) => `${e.loc?.slice(1).join(".") || "Input"}: ${e.msg}`)
          .join("; ")
      : data.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return response.json();
}
const send = (url, method, body) =>
  api(url, { method, body: JSON.stringify(body) });
function toast(message, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.innerHTML =
    icon(error ? "alert" : "check") +
    `<span>${esc(message)}</span><button class="icon-button" aria-label="Dismiss notification">${icon("close")}</button>`;
  el.querySelector("button").onclick = () => el.remove();
  const container = document.getElementById("toasts");
  while (container.children.length >= 3) container.firstElementChild.remove();
  container.append(el);
  setTimeout(() => el.remove(), error ? 14000 : 6500);
}
function loading(message = "Loading your workspace") {
  main.innerHTML = `<div class="loading-page"><span class="spinner"></span><p>${esc(message)}…</p></div>`;
}
function errorPage(error) {
  main.innerHTML = empty(
    "Let’s reconnect",
    error.message,
    button("Try again", "refresh", "refresh", "primary"),
  );
}
function timeAgo(date) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(date)) / 1000));
  return secs < 60
    ? "Just now"
    : secs < 3600
      ? `${Math.floor(secs / 60)}m ago`
      : secs < 86400
        ? `${Math.floor(secs / 3600)}h ago`
        : new Date(date).toLocaleDateString();
}
function heading(title, subtitle, actions = "", eyebrow = "YOUR WORKSPACE") {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function metric(label, value, foot, name, dot = false) {
  return `<div class="metric"><div class="metric-label">${esc(label)}${icon(name)}</div><div class="metric-value">${esc(value)}</div><div class="metric-bottom">${dot ? '<span class="live-dot"></span>' : ""}${esc(foot)}</div></div>`;
}
function statusTag(status) {
  const color = ["ACTIVE", "completed"].includes(status)
    ? "green"
    : ["failed", "ERROR"].includes(status)
      ? "red"
      : "purple";
  return `<span class="tag ${color}">${esc(status === "ACTIVE" ? "Active" : status[0].toUpperCase() + status.slice(1).toLowerCase())}</span>`;
}
function activeBanner() {
  const jobs = state.operations.filter((o) =>
    ["queued", "running"].includes(o.status),
  );
  return jobs.length
    ? `<div class="operation-banner"><span class="spinner small-spinner"></span>${jobs.length === 1 ? esc(jobs[0].action) + " · " + esc(jobs[0].table) : `${jobs.length} operations in progress`}<a href="#activity">View activity</a></div>`
    : "";
}
function activityRows(ops, full = false) {
  return ops
    .map(
      (op) =>
        `<div class="activity-row"><span class="activity-symbol ${esc(op.status)}">${icon(op.status === "failed" ? "alert" : op.status === "completed" ? "check" : "clock")}</span><div><strong>${esc(op.action)}</strong>${full ? statusTag(op.status) : ""}<p>${esc(op.table || "Workspace")}</p>${full && op.detail ? `<p>${esc(op.detail)}</p>` : ""}${full ? "" : `<time datetime="${esc(op.startedAt)}">${timeAgo(op.startedAt)}</time>`}</div>${full ? `<time datetime="${esc(op.startedAt)}">${timeAgo(op.startedAt)}</time>` : ""}</div>`,
    )
    .join("");
}
function tableRows(tables) {
  return tables
    .map((table) => {
      const pk = table.KeySchema.find(
        (k) => k.KeyType === "HASH",
      ).AttributeName;
      const sk = table.KeySchema.find(
        (k) => k.KeyType === "RANGE",
      )?.AttributeName;
      return `<tr><td><a href="${tableHash(table.TableName)}" class="table-link"><span class="table-symbol">${icon("table")}</span><div>${esc(table.TableName)}<small>${esc(table.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST" ? "On-demand" : "Provisioned")} capacity</small></div></a></td><td>${statusTag(table.TableStatus)}</td><td><span class="key-tag">${esc(pk)}</span>${sk ? ` <span class="key-tag">${esc(sk)}</span>` : ""}</td><td>${fmt(table.ItemCount)}</td><td class="table-secondary-col">${bytes(table.TableSizeBytes)}</td><td><a class="icon-button" href="${tableHash(table.TableName)}" aria-label="Browse ${esc(table.TableName)}">${icon("arrow")}</a></td></tr>`;
    })
    .join("");
}
function tablePanel(tables, all = false) {
  return `<section class="panel"><div class="panel-heading"><div><h2>${all ? "All tables" : "Your tables"}<span class="count-badge">${tables.length}</span></h2><p>Your data, organized and ready to explore.</p></div>${all ? "" : `<a href="#tables" class="button text">View all ${icon("arrow")}</a>`}</div><div class="panel-toolbar"><label class="search">${icon("search")}<input id="table-filter" placeholder="Search tables…" aria-label="Search tables"><kbd>/</kbd></label><span class="hint">${icon("database").replace("<svg", '<svg style="display:inline;width:11px;height:11px;vertical-align:middle"')} ${tables.length} ${tables.length === 1 ? "table" : "tables"} in this workspace</span></div>${tables.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table"><table aria-label="DynamoDB tables"><thead><tr><th>Table name</th><th>Status</th><th>Primary keys</th><th>Items</th><th class="table-secondary-col">Size</th><th><span class="sr-only">Open table</span></th></tr></thead><tbody id="table-rows">${tableRows(tables)}</tbody></table></div><div class="empty hidden" id="no-table-matches"><h3>No matching tables</h3><p>Try a different table name.</p></div><div class="panel-foot"><span>Item counts and sizes are DynamoDB estimates.</span><span>${tables.length} tables</span></div>` : empty("A fresh start for your data", "Create your first table, then add a few items or import a file.", button("Create a table", "create-table", "plus", "primary"))}</section>`;
}
function renderOverview() {
  const data = state.overview,
    tables = data.tables;
  const items = tables.reduce((n, t) => n + (t.ItemCount || 0), 0);
  const size = tables.reduce((n, t) => n + (t.TableSizeBytes || 0), 0);
  main.innerHTML =
    heading(
      "Workspace overview",
      "A clear view of your tables, your data, and what’s happening.",
      `<a href="#imports" class="button">${icon("upload")}Import data</a>${button("Create table", "create-table", "plus", "primary")}`,
    ) +
    activeBanner() +
    `<div class="overview-grid"><div><div class="welcome"><div><div class="eyebrow" style="color:#705d85">ROOM TO BUILD</div><h2>Your next idea starts with good data.</h2><p>Explore your tables, try a query, or bring in something new. All in one local workspace.</p></div><span class="welcome-icon">${icon("layers")}</span></div><div class="metrics">${metric("Total tables", fmt(tables.length), "Ready to explore", "table", true)}${metric("Stored items", fmt(items), "Estimated by DynamoDB", "layers")}${metric("Storage used", bytes(size), "Across all tables", "storage")}</div>${tablePanel(tables)}<div class="note-card">${icon("info")}<div><h3>A workspace for experimenting.</h3><p>Browse and edit your data with confidence. Table deletion and purging always require confirmation; imports show a preview before you begin.</p></div></div></div><aside class="overview-aside"><section class="panel side-panel"><h2>${icon("database")}Connection</h2><p class="description">Your workspace is connected and ready to go.</p><span class="tag green">Connected</span><dl class="connection-details"><div><dt>Endpoint</dt><dd title="${esc(data.connection.endpoint)}">${esc(data.connection.endpoint.replace(/^https?:\/\//, ""))}</dd></div><div><dt>Region</dt><dd>${esc(data.connection.region)}</dd></div><div><dt>Startup</dt><dd>${esc(data.startup)}</dd></div></dl></section><section class="panel side-panel"><h2>Quick actions</h2><button class="quick-action" data-action="create-table"><span class="quick-icon">${icon("plus")}</span><span><strong>Create a table</strong><small>A home for something new</small></span>${icon("chevron")}</button><a href="#imports" class="quick-action"><span class="quick-icon">${icon("upload")}</span><span><strong>Bring your data</strong><small>Import CSV or JSON</small></span>${icon("chevron")}</a><a href="/docs" target="_blank" rel="noopener" class="quick-action"><span class="quick-icon">${icon("code")}</span><span><strong>Explore the API</strong><small>Make it part of your workflow</small></span>${icon("chevron")}</a></section><section class="panel side-panel"><h2>Recent activity<a href="#activity" class="button text" style="margin-left:auto;min-height:0;font-size:9px">View all</a></h2>${state.operations.length ? activityRows(state.operations.slice(0, 3)) : empty("All quiet for now", "Your imports and changes will appear here.", "", true)}</section></aside></div>`;
  document
    .getElementById("table-filter")
    ?.addEventListener("input", filterTables);
}
function filterTables(event) {
  const tables = state.overview.tables.filter((t) =>
    t.TableName.toLowerCase().includes(event.target.value.toLowerCase()),
  );
  const rows = document.getElementById("table-rows");
  if (rows) rows.innerHTML = tableRows(tables);
  document
    .getElementById("no-table-matches")
    ?.classList.toggle("hidden", tables.length > 0);
}
function renderTables() {
  main.innerHTML =
    heading(
      "Tables",
      "The building blocks of your workspace.",
      button("Create table", "create-table", "plus", "primary"),
    ) +
    activeBanner() +
    tablePanel(state.overview.tables, true);
  document
    .getElementById("table-filter")
    ?.addEventListener("input", filterTables);
}
async function refreshOverview(render = true) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      state.overview = await api("/api/overview");
      state.operations = state.overview.operations;
      document.getElementById("nav-table-count").textContent =
        state.overview.tables.length;
      document.getElementById("connection-status").textContent = "Connected";
      document.getElementById("connection-region").textContent =
        state.overview.connection.region;
      document.getElementById("connection-dot").classList.remove("offline");
      document.getElementById("last-sync").textContent =
        "Last synced " +
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      if (render) await renderRoute();
    } catch (error) {
      document.getElementById("connection-status").textContent = "Disconnected";
      document.getElementById("connection-dot").classList.add("offline");
      errorPage(error);
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}
async function navigate() {
  const [route, name] = location.hash.replace(/^#\/?/, "").split("/");
  state.route = [
    "overview",
    "tables",
    "imports",
    "activity",
    "settings",
  ].includes(route)
    ? route
    : "overview";
  state.table = name ? decodeURIComponent(name) : null;
  state.generation++;
  state.importFile = null;
  state.savedQueryId = "";
  state.detailTab = "items";
  state.page = 1;
  state.cursors = [null];
  state.search = { mode: "scan", index: null, limit: 25 };
  setSidebar(false);
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === state.route);
    if (el.dataset.nav === state.route) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  document.getElementById("breadcrumb").textContent =
    state.table ||
    {
      overview: "Overview",
      tables: "Tables",
      imports: "Import data",
      activity: "Activity",
      settings: "Settings",
    }[state.route];
  document.title =
    (state.table || document.getElementById("breadcrumb").textContent) +
    " · DynamoDB Tools";
  if (state.overview) await renderRoute();
  else await refreshOverview();
}
async function renderRoute() {
  const generation = state.generation;
  try {
    if (state.route === "overview") renderOverview();
    else if (state.route === "tables" && !state.table) renderTables();
    else if (state.route === "tables") await renderDetail(generation);
    else if (state.route === "imports") await renderImports(generation);
    else if (state.route === "activity") renderActivity();
    else if (state.route === "settings") await renderSettings(generation);
  } catch (error) {
    if (generation === state.generation) errorPage(error);
  }
}
function keySchema(detail = state.detail, index = state.search.index) {
  return index
    ? (detail.GlobalSecondaryIndexes || [])
        .concat(detail.LocalSecondaryIndexes || [])
        .find((i) => i.IndexName === index)?.KeySchema || detail.KeySchema
    : detail.KeySchema;
}
function keyOf(item) {
  return Object.fromEntries(
    state.detail.KeySchema.map((key) => [
      key.AttributeName,
      item[key.AttributeName],
    ]),
  );
}
function attrDisplay(attribute) {
  if (!attribute) return "—";
  const [kind, val] = Object.entries(attribute)[0] || [];
  if (kind === "NULL") return "null";
  if (kind === "BOOL") return String(val);
  if (kind === "S" || kind === "N") return String(val);
  if (kind === "B") return `[binary · ${val.length} base64 chars]`;
  if (kind === "M")
    return (
      "{ " +
      Object.entries(val)
        .map(([k, v]) => k + ": " + attrDisplay(v))
        .join(", ") +
      " }"
    );
  if (kind === "L") return "[" + val.map(attrDisplay).join(", ") + "]";
  return "[" + (val || []).join(", ") + "]";
}
async function renderDetail(generation = state.generation) {
  const name = state.table;
  loading("Opening " + name);
  const detail = await api(tablePath(name));
  if (generation !== state.generation) return;
  state.detail = detail;
  const pk = detail.KeySchema.find((k) => k.KeyType === "HASH").AttributeName,
    sk = detail.KeySchema.find((k) => k.KeyType === "RANGE")?.AttributeName;
  main.innerHTML = `<a class="back-link" href="#tables">${icon("left")}All tables</a><div class="page-heading table-heading"><div><h1>${esc(name)}${statusTag(detail.TableStatus)}</h1><div class="detail-metrics"><span>Partition key<strong class="mono">${esc(pk)}</strong></span>${sk ? `<span>Sort key<strong class="mono">${esc(sk)}</strong></span>` : ""}<span>Items (est.)<strong>${fmt(detail.ItemCount)}</strong></span><span>Size<strong>${bytes(detail.TableSizeBytes)}</strong></span></div></div><div class="heading-actions">${button("Export", "export", "download")}${button("Add item", "add-item", "plus", "primary")}</div></div>${activeBanner()}<div class="tabs" role="tablist" aria-label="Table views">${[
    ["items", "Items", "table"],
    ["import", "Import data", "upload"],
    ["streams", "Streams", "activity"],
    ["partiql", "PartiQL", "code"],
    ["schema", "Schema & indexes", "layers"],
    ["manage", "Manage table", "settings"],
  ]
    .map(
      ([tab, label, ico]) =>
        `<button role="tab" tabindex="${state.detailTab === tab ? 0 : -1}" id="tab-${tab}" aria-controls="detail-content" aria-selected="${state.detailTab === tab}" class="tab ${state.detailTab === tab ? "active" : ""}" data-action="detail-tab" data-tab="${tab}">${icon(ico)}${label}</button>`,
    )
    .join(
      "",
    )}</div><div id="detail-content" role="tabpanel" aria-labelledby="tab-${state.detailTab}"></div>`;
  await renderDetailTab();
}
async function renderDetailTab() {
  const generation = state.generation;
  const content = document.getElementById("detail-content");
  if (!content) return;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === state.detailTab);
    tab.setAttribute("aria-selected", tab.dataset.tab === state.detailTab);
    tab.tabIndex = tab.dataset.tab === state.detailTab ? 0 : -1;
  });
  content.setAttribute("aria-labelledby", "tab-" + state.detailTab);
  if (state.detailTab === "items") {
    renderExplorer();
    await loadItems();
  } else if (state.detailTab === "streams") {
    await renderStreams();
  } else if (state.detailTab === "partiql") {
    renderPartiQL();
  } else if (state.detailTab === "schema") {
    const d = state.detail;
    const indexes = (d.GlobalSecondaryIndexes || []).concat(
      d.LocalSecondaryIndexes || [],
    );
    content.innerHTML = `<div class="split"><section class="panel"><div class="panel-heading"><div><h2>Primary key</h2><p>The attributes that make each item unique.</p></div>${icon("key")}</div><div class="panel-body">${d.KeySchema.map((k) => `<div class="schema-row"><span>${k.KeyType === "HASH" ? "Partition key" : "Sort key"}</span><strong class="mono">${esc(k.AttributeName)} <span class="tag">${esc(d.AttributeDefinitions.find((a) => a.AttributeName === k.AttributeName)?.AttributeType)}</span></strong></div>`).join("")}<div class="schema-row"><span>Billing mode</span><span>${d.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST" ? "On-demand" : "Provisioned"}</span></div><div class="schema-row"><span>Table status</span>${statusTag(d.TableStatus)}</div><div class="schema-row"><span>Created</span><span>${new Date(d.CreationDateTime).toLocaleDateString()}</span></div></div></section><section class="panel"><div class="panel-heading"><div><h2>Secondary indexes <span class="count-badge">${indexes.length}</span></h2><p>More ways to query your data.</p></div>${button("Edit", "update-schema", "edit", "small")}</div><div class="panel-body">${indexes.length ? indexes.map((i) => `<div class="schema-row"><div><strong>${esc(i.IndexName)}</strong><p class="info-note">${i.KeySchema.map((k) => esc(k.AttributeName)).join(" + ")} · ${esc(i.Projection.ProjectionType)}</p></div>${statusTag(i.IndexStatus || "ACTIVE")}</div>`).join("") : empty("No secondary indexes", "Add an index with a schema update to query another key.", "", true)}</div></section></div><section class="panel mt"><div class="panel-heading"><h2>Full table definition</h2>${button("Copy JSON", "copy-schema", "copy", "small")}</div><div class="panel-body"><pre class="code-block" tabindex="0">${esc(JSON.stringify(d, null, 2))}</pre></div></section>`;
  } else if (state.detailTab === "import") {
    state.importTable = state.table;
    content.innerHTML = importLayout(false);
    bindImport();
    await loadMounted(generation);
  } else {
    content.innerHTML = `<section class="panel"><div class="panel-heading"><div><h2>Table configuration</h2><p>Update capacity or create, update, and delete secondary indexes.</p></div>${button("Update schema", "update-schema", "code")}</div><div class="panel-body"><p class="info-note" style="margin:0">Schema changes use the DynamoDB UpdateTable format. Existing data stays in place. Primary keys cannot be changed after table creation.</p></div></section><section class="panel danger-panel"><div class="panel-heading"><h2>Destructive actions</h2></div><div class="panel-body"><div class="danger-action"><div><h3>Purge all items</h3><p>Empty this table while keeping its schema and indexes. This cannot be undone.</p></div>${button("Purge table", "purge-table", "trash", "danger-outline")}</div><div class="danger-action"><div><h3>Delete this table</h3><p>Remove the table, every item, and all its indexes. This cannot be undone.</p></div>${button("Delete table", "delete-table", "trash", "danger-outline")}</div></div></section>`;
    await renderTTL(content, generation);
  }
}
function renderExplorer() {
  const d = state.detail,
    indexes = (d.GlobalSecondaryIndexes || []).concat(
      d.LocalSecondaryIndexes || [],
    );
  document.getElementById("detail-content").innerHTML =
    `<section class="panel"><div id="saved-query-bar" class="saved-query-bar"></div><form id="query-form" class="query-bar"><div class="field"><label for="query-mode">Explore with</label><select id="query-mode"><option value="scan">Scan</option><option value="query">Query</option></select></div><div class="field"><label for="query-index">Table / index</label><select id="query-index"><option value="">Primary index</option>${indexes.map((i) => `<option value="${esc(i.IndexName)}">${esc(i.IndexName)}</option>`).join("")}</select></div><div class="field"><label for="query-limit">Page size</label><select id="query-limit"><option>25</option><option>50</option><option>100</option></select></div><div id="query-fields" class="query-fields hidden"></div><button class="button primary" type="submit">${icon("play")}Run ${state.search.mode}</button><p class="query-note" id="query-note">Scan reads a page of items. Use Query to look up a partition key efficiently.</p><div id="read-options" class="read-options"></div></form><div class="panel-toolbar"><label class="search">${icon("search")}<input id="item-filter" placeholder="Filter this page…" aria-label="Filter items on this page"></label><div class="button-group"><span id="item-result-label" class="hint"></span>${button("Refresh", "reload-items", "refresh", "small")}</div></div><div class="bulk-toolbar"><span id="selection-count">Select items to act on this page</span><div class="button-group"><button type="button" class="button small" data-action="export-page">Export page</button><button type="button" class="button small danger-outline" id="delete-selected" data-action="delete-selected" disabled>Delete selected</button></div></div><div id="items-container"><div class="empty"><span class="spinner"></span></div></div><div class="panel-foot"><span id="page-label">Loading items…</span><div class="pagination"><button class="button" data-action="prev-page" disabled>${icon("left")}Previous</button><button class="button" data-action="next-page" disabled>Next${icon("arrow")}</button></div></div></section>`;
  document.getElementById("query-mode").value = state.search.mode;
  document.getElementById("query-index").value = state.search.index || "";
  document.getElementById("query-limit").value = state.search.limit;
  renderSavedQueries();
  renderReadOptions();
  renderQueryFields();
  document.getElementById("query-mode").onchange = renderQueryFields;
  document.getElementById("query-index").onchange = renderQueryFields;
  document.getElementById("query-form").onsubmit = runQuery;
  document.getElementById("item-filter").oninput = renderItems;
}
function renderQueryFields() {
  const mode = document.getElementById("query-mode").value,
    index = document.getElementById("query-index").value;
  const fields = document.getElementById("query-fields");
  fields.classList.toggle("hidden", mode !== "query");
  document.querySelector("#query-form button[type=submit]").innerHTML =
    icon("play") + "Run " + mode;
  const keys = keySchema(state.detail, index),
    types = Object.fromEntries(
      state.detail.AttributeDefinitions.map((a) => [
        a.AttributeName,
        a.AttributeType,
      ]),
    );
  const pk = keys.find((k) => k.KeyType === "HASH").AttributeName,
    sk = keys.find((k) => k.KeyType === "RANGE")?.AttributeName;
  fields.innerHTML = `<div class="field query-value"><label for="query-pk">${esc(pk)} <span class="muted">${types[pk]}</span></label><input id="query-pk" placeholder="Partition key value" value="${esc(state.search.partition ? Object.values(state.search.partition)[0] : "")}"></div>${sk ? `<div class="field"><label for="query-operator">Sort condition</label><select id="query-operator">${["=", "begins_with", "between", "<", "<=", ">", ">="].map((op) => `<option value="${esc(op)}" ${state.search.operator === op ? "selected" : ""}>${op === "begins_with" ? "Begins with" : esc(op)}</option>`).join("")}</select></div><div class="field query-value"><label for="query-sk">${esc(sk)} <span class="muted">${types[sk]}</span></label><input id="query-sk" placeholder="Optional sort key" value="${esc(state.search.sort ? Object.values(state.search.sort)[0] : "")}"></div><div class="field query-value ${state.search.operator === "between" ? "" : "hidden"}" id="query-end-field"><label for="query-end">Range end</label><input id="query-end" placeholder="Inclusive end value" value="${esc(state.search.sortEnd ? Object.values(state.search.sortEnd)[0] : "")}"></div>` : ""}<div class="field"><label for="query-order">Order</label><select id="query-order"><option value="asc">Ascending</option><option value="desc" ${state.search.ascending === false ? "selected" : ""}>Descending</option></select></div>`;
  if (document.getElementById("query-operator"))
    document.getElementById("query-operator").onchange = () =>
      document
        .getElementById("query-end-field")
        .classList.toggle(
          "hidden",
          document.getElementById("query-operator").value !== "between",
        );
  document.getElementById("query-note").textContent =
    mode === "query"
      ? "Enter a partition key. Numbers stay exact; binary keys use base64."
      : "Scan reads a page of items. Use Query to look up a partition key efficiently.";
}
function readQueryForm() {
  const mode = document.getElementById("query-mode").value,
    index = document.getElementById("query-index").value || null;
  const request = {
    mode,
    index,
    limit: Number(document.getElementById("query-limit").value),
  };
  if (mode === "query") {
    const keys = keySchema(state.detail, index),
      types = Object.fromEntries(
        state.detail.AttributeDefinitions.map((a) => [
          a.AttributeName,
          a.AttributeType,
        ]),
      );
    const pk = keys.find((k) => k.KeyType === "HASH").AttributeName,
      value = document.getElementById("query-pk").value;
    if (!value) {
      throw new Error("Enter a partition key value.");
    }
    request.partition = { [types[pk]]: value };
    const sk = keys.find((k) => k.KeyType === "RANGE")?.AttributeName,
      sv = document.getElementById("query-sk")?.value;
    if (sk && sv) request.sort = { [types[sk]]: sv };
    request.operator = document.getElementById("query-operator")?.value || "=";
    if (request.operator === "between") {
      const end = document.getElementById("query-end").value;
      if (!sv || !end) {
        throw new Error("Enter both values for the sort-key range.");
      }
      request.sortEnd = { [types[sk]]: end };
    }
    request.ascending = document.getElementById("query-order").value === "asc";
  }
  Object.assign(request, readOptions());
  return request;
}
async function runQuery(event) {
  event.preventDefault();
  try {
    state.search = readQueryForm();
  } catch (error) {
    toast(error.message, true);
    return;
  }
  state.page = 1;
  state.cursors = [null];
  await loadItems();
}
// Saved definitions belong to this browser, connection, region, and table.
function savedQueryKey() {
  const connection = state.overview.connection;
  return (
    "dynamodb-tools.saved-queries.v1:" +
    JSON.stringify([connection.endpoint, connection.region, state.table])
  );
}
function readSavedQueries(key = savedQueryKey()) {
  try {
    const queries = JSON.parse(localStorage.getItem(key) || "[]");
    if (
      !Array.isArray(queries) ||
      queries.some(
        (q) =>
          !q ||
          typeof q.id !== "string" ||
          typeof q.name !== "string" ||
          typeof q.filter !== "string" ||
          typeof q.schema !== "string" ||
          !q.request ||
          !["scan", "query"].includes(q.request.mode) ||
          ![25, 50, 100].includes(q.request.limit) ||
          !(q.request.index === null || typeof q.request.index === "string") ||
          (q.request.mode === "query" &&
            !validSavedAttribute(q.request.partition)) ||
          (q.request.sort && !validSavedAttribute(q.request.sort)) ||
          (q.request.sortEnd && !validSavedAttribute(q.request.sortEnd)),
      )
    )
      throw new Error("Invalid saved data");
    return queries;
  } catch {
    throw new Error(
      "Saved queries are unavailable. Check this site's browser storage permissions or clear its saved data.",
    );
  }
}
function validSavedAttribute(value) {
  return (
    value &&
    Object.keys(value).length === 1 &&
    ["S", "N", "B"].includes(Object.keys(value)[0]) &&
    typeof Object.values(value)[0] === "string"
  );
}
function writeSavedQueries(key, queries) {
  try {
    localStorage.setItem(key, JSON.stringify(queries));
  } catch {
    throw new Error(
      "Could not save changes. Browser storage may be full or disabled. Your previous saved queries are unchanged.",
    );
  }
}
function querySchema(index) {
  const keys = index
    ? (state.detail.GlobalSecondaryIndexes || [])
        .concat(state.detail.LocalSecondaryIndexes || [])
        .find((i) => i.IndexName === index)?.KeySchema
    : state.detail.KeySchema;
  if (!keys)
    throw new Error(
      "This saved query's index no longer exists. Choose another index and save a new query.",
    );
  return JSON.stringify(
    keys
      .map((key) => [
        key.KeyType,
        key.AttributeName,
        state.detail.AttributeDefinitions.find(
          (a) => a.AttributeName === key.AttributeName,
        )?.AttributeType,
      ])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}
function renderSavedQueries() {
  const bar = document.getElementById("saved-query-bar");
  if (!bar) return;
  try {
    const queries = readSavedQueries().sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (!queries.some((q) => q.id === state.savedQueryId))
      state.savedQueryId = "";
    bar.innerHTML = `<div class="field saved-query-picker"><label for="saved-query">${icon("bookmark")}Saved queries <span class="count-badge">${queries.length}</span></label><select id="saved-query"><option value="">${queries.length ? "Choose a saved query…" : "No saved queries yet"}</option>${queries.map((q) => `<option value="${esc(q.id)}">${esc(q.name)}</option>`).join("")}</select></div><div class="button-group">${button("Load query", "load-query", "play", "small")}${button("Manage", "manage-query", "edit", "small")}${button("Save query", "save-query", "bookmark", "small")}</div><p class="saved-query-note">Saved in this browser for this connection and table.</p>`;
    const select = document.getElementById("saved-query");
    select.value = state.savedQueryId;
    const updateButtons = () => {
      state.savedQueryId = select.value;
      bar
        .querySelectorAll(
          '[data-action="load-query"], [data-action="manage-query"]',
        )
        .forEach((b) => (b.disabled = !select.value));
    };
    select.onchange = updateButtons;
    updateButtons();
  } catch (error) {
    bar.innerHTML = `<p class="saved-query-note" role="status">${esc(error.message)}</p>`;
  }
}
function selectedSavedQuery() {
  const query = readSavedQueries().find((q) => q.id === state.savedQueryId);
  if (!query)
    throw new Error(
      "This saved query is no longer available. Choose another one.",
    );
  return query;
}
function saveQueryDialog(manage = false) {
  const saved = manage ? selectedSavedQuery() : null;
  // Validate current controls before offering to save a new definition.
  const request = manage ? null : readQueryForm();
  openDialog(
    manage ? "Manage saved query" : "Save query",
    "Keep a useful query close at hand. Saved only in this browser.",
    `<div class="field"><label for="saved-query-name">Query name</label><input id="saved-query-name" required maxlength="80" autocomplete="off" placeholder="e.g. Recent pending orders" value="${esc(saved?.name || "")}"></div>${manage ? '<label class="saved-query-update"><input type="checkbox" id="saved-query-update">Replace saved settings with the current explorer settings</label>' : '<p class="editor-help">Includes the index, key conditions, sort order, page size, and page filter. Loading starts from the first page.</p>'}`,
    `${manage ? button("Delete saved query", "delete-saved-query", "trash", "danger-outline") : ""}<button class="button primary" type="submit">${icon("bookmark")}${manage ? "Save changes" : "Save query"}</button>`,
    {
      kind: "save-query",
      key: savedQueryKey(),
      saved,
      request,
      filter: document.getElementById("item-filter").value,
    },
  );
}
async function loadSavedQuery() {
  const saved = selectedSavedQuery();
  if (saved.schema !== querySchema(saved.request.index))
    throw new Error(
      "The table or index keys have changed since this query was saved. Review the current keys and save a new query.",
    );
  state.search = structuredClone(saved.request);
  state.page = 1;
  state.cursors = [null];
  renderExplorer();
  document.getElementById("item-filter").value = saved.filter;
  await loadItems();
  document.getElementById("query-mode")?.focus();
}
function submitSavedQuery(context) {
  const queries = readSavedQueries(context.key);
  const position = queries.findIndex((q) => q.id === context.saved?.id);
  if (context.saved && position < 0)
    throw new Error(
      "This query was deleted in another tab. Save a new query instead.",
    );
  if (context.kind === "delete-saved-query") {
    queries.splice(position, 1);
    writeSavedQueries(context.key, queries);
    state.savedQueryId = "";
  } else {
    const name = document.getElementById("saved-query-name").value.trim();
    if (!name) throw new Error("Enter a query name.");
    if (
      queries.some(
        (q) =>
          q.id !== context.saved?.id &&
          q.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error(
        "A query with this name already exists. Use a different name or manage the existing query.",
      );
    const replace =
      !context.saved || document.getElementById("saved-query-update").checked;
    const request = replace
      ? context.request || readQueryForm()
      : queries[position].request;
    const saved = {
      id: context.saved?.id || crypto.randomUUID(),
      name,
      request,
      filter: replace ? context.filter : queries[position].filter,
      schema: replace ? querySchema(request.index) : queries[position].schema,
    };
    if (position < 0) queries.push(saved);
    else queries[position] = saved;
    writeSavedQueries(context.key, queries);
    state.savedQueryId = saved.id;
  }
  dialog.close();
  renderSavedQueries();
  toast(
    context.kind === "delete-saved-query"
      ? "Saved query deleted."
      : "Query saved in this browser.",
  );
}
window.addEventListener("storage", (event) => {
  if (
    state.table &&
    state.overview &&
    (event.key === savedQueryKey() || event.key === null)
  )
    renderSavedQueries();
});
let itemRequest = 0;
async function loadItems() {
  const request = ++itemRequest,
    generation = state.generation;
  state.busy = true;
  document.getElementById("items-container").innerHTML =
    '<div class="empty"><span class="spinner"></span><p style="margin-top:12px">Reading items…</p></div>';
  document
    .querySelectorAll("#query-form button,.pagination button")
    .forEach((b) => (b.disabled = true));
  try {
    const result = await send(
      tablePath(state.table) + "/items/search",
      "POST",
      { ...state.search, cursor: state.cursors[state.page - 1] },
    );
    if (
      request !== itemRequest ||
      generation !== state.generation ||
      state.detailTab !== "items"
    )
      return;
    state.items = result.items;
    state.nextCursor = result.cursor;
    state.result = result;
    document.getElementById("item-result-label").textContent =
      `${fmt(result.count)} items · ${result.capacity} RCU`;
    renderItems();
    document.getElementById("page-label").textContent =
      `Page ${state.page} · ${fmt(result.scanned)} items evaluated`;
    document.querySelector("[data-action=prev-page]").disabled =
      state.page === 1;
    document.querySelector("[data-action=next-page]").disabled = !result.cursor;
  } catch (error) {
    if (
      request !== itemRequest ||
      generation !== state.generation ||
      !document.getElementById("items-container")
    )
      return;
    document.getElementById("items-container").innerHTML =
      `<div class="panel-body"><div class="error-banner">${esc(error.message)}</div></div>`;
    document.getElementById("page-label").textContent =
      "Query could not be completed";
  } finally {
    if (request === itemRequest) {
      state.busy = false;
      document
        .querySelectorAll("#query-form button")
        .forEach((b) => (b.disabled = false));
    }
  }
}
function renderItems() {
  const filter =
    document.getElementById("item-filter")?.value.toLowerCase() || "";
  const items = state.items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) =>
      Object.values(item).some((v) =>
        attrDisplay(v).toLowerCase().includes(filter),
      ),
    );
  const container = document.getElementById("items-container");
  if (!container) return;
  resetSelection();
  if (!items.length) {
    container.innerHTML = empty(
      filter
        ? "No matches on this page"
        : state.search.filters?.length || state.search.filterExpression
          ? "No matches in this read page"
          : state.search.mode === "query"
            ? "No matching items"
            : "Nothing here yet",
      filter
        ? "Try another filter or move to the next page."
        : state.search.filters?.length || state.search.filterExpression
          ? "Filters apply after reading. Continue to the next page if available, or adjust your filters."
          : state.search.mode === "query"
            ? "Try a different partition key or sort condition."
            : "Add your first item or import a CSV or JSON file.",
      filter ? "" : button("Add item", "add-item", "plus", "primary"),
    );
    return;
  }
  const keys = state.detail.KeySchema.map((k) => k.AttributeName);
  const columns = [
    ...new Set([...keys, ...items.flatMap(({ item }) => Object.keys(item))]),
  ];
  container.innerHTML = `<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="data-table" aria-label="Table items"><thead><tr><th><input type="checkbox" id="select-page" aria-label="Select all visible items"></th>${columns.map((c) => `<th>${keys.includes(c) ? '<span style="color:var(--purple);margin-right:5px">⌑</span>' : ""}${esc(c)}<span class="attr-type">${esc(Object.keys(items.find(({ item }) => item[c])?.item[c] || {})[0] || "")}</span></th>`).join("")}<th><span class="sr-only">Edit item</span></th></tr></thead><tbody>${items.map(({ item, i }) => `<tr><td><input type="checkbox" class="item-selection" data-row="${i}" aria-label="Select item ${esc(attrDisplay(item[keys[0]]))} ${esc(keys[1] ? attrDisplay(item[keys[1]]) : "")}"></td>${columns.map((c) => `<td title="${esc(attrDisplay(item[c]))}">${esc(attrDisplay(item[c]))}</td>`).join("")}<td class="row-actions"><button class="icon-button" data-action="edit-item" data-row="${i}" aria-label="Open item ${esc(attrDisplay(item[keys[0]]))}" title="View or edit item">${icon("edit")}</button></td></tr>`).join("")}</tbody></table></div>`;
  bindSelection();
}
function importLayout(withSelect = true) {
  return `<div class="split"><section class="panel"><div class="panel-heading"><div><h2>Bring your data</h2><p>A fresh file. An existing table. Ready when you are.</p></div><span class="tag purple">CSV + JSON</span></div><div class="panel-body">${withSelect ? `<div class="field"><label for="import-table">Destination table</label><select id="import-table"><option value="">Choose a table…</option>${state.overview.tables.map((t) => `<option value="${esc(t.TableName)}" ${state.importTable === t.TableName ? "selected" : ""}>${esc(t.TableName)}</option>`).join("")}</select></div>` : `<p class="info-note" style="margin:0 0 17px">Import into <strong>${esc(state.importTable)}</strong></p>`}<label class="upload-zone" id="upload-zone"><span class="upload-icon">${icon("upload")}</span><h3>Drop a file here, or <span style="color:var(--purple)">browse files</span></h3><p>CSV, JSON, or DynamoDB JSON · up to 10 MB</p><span class="tag">Your file is validated before import</span><input type="file" id="upload-file" accept=".csv,.json" aria-label="Choose a CSV or JSON file to import"></label><div id="upload-preview"></div><p class="info-note">Items with matching primary keys will be replaced. Imports are not transactional: if a later batch fails, earlier writes remain. CSV values are imported as strings.</p></div></section><div><section class="panel"><div class="panel-heading"><div><h2>Mounted files</h2><p>Ready-to-load files from your data folder.</p></div>${icon("file")}</div><div class="panel-body" id="mounted-files">${empty("Choose a destination", "Select a table to see its mounted data files.", "", true)}</div></section><div class="note-card">${icon("info")}<div><h3>Keep your types intact.</h3><p>Plain JSON supports nested data and exact decimals. DynamoDB JSON also preserves sets and binary values. Exports use this format so you can bring them right back.</p></div></div></div></div>`;
}
async function renderImports(generation = state.generation) {
  if (
    state.importTable &&
    !state.overview.tables.some((t) => t.TableName === state.importTable)
  )
    state.importTable = null;
  main.innerHTML =
    heading(
      "Bring your data to life",
      "Import a file, preview its contents, and make it part of your workspace.",
    ) +
    activeBanner() +
    (state.overview.tables.length
      ? importLayout()
      : empty(
          "Create a table first",
          "Imports need a destination. Create a table with the keys your data uses.",
          button("Create table", "create-table", "plus", "primary"),
        ));
  if (state.overview.tables.length) {
    bindImport();
    await loadMounted(generation);
  }
}
function bindImport() {
  document
    .getElementById("import-table")
    ?.addEventListener("change", async (e) => {
      state.importTable = e.target.value;
      state.importFile = null;
      document.getElementById("upload-preview").innerHTML = "";
      await loadMounted();
    });
  document.getElementById("upload-file")?.addEventListener("change", (e) => {
    if (e.target.files[0]) previewFile(e.target.files[0]);
  });
  const zone = document.getElementById("upload-zone");
  zone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone?.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone?.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) previewFile(e.dataTransfer.files[0]);
  });
}
async function loadMounted(generation = state.generation) {
  const target = state.importTable;
  if (!target) return;
  const container = document.getElementById("mounted-files");
  if (!container) return;
  container.innerHTML =
    '<div class="empty compact"><span class="spinner"></span></div>';
  try {
    const files = await api(tablePath(target) + "/files");
    if (generation !== state.generation || state.importTable !== target) return;
    container.innerHTML = files.length
      ? files
          .map(
            (f) =>
              `<div class="file-row"><span class="file-icon">${icon("file")}</span><div><strong>${esc(f.name)}</strong><small>${esc(f.format)} · ${bytes(f.bytes)}</small></div>${button("Load", "load-mounted", "upload", "small", `data-file="${esc(f.name)}"`)}</div>`,
          )
          .join("")
      : empty(
          "No mounted files yet",
          `Add files to load/${target} in your configured data folder.`,
          "",
          true,
        );
  } catch (error) {
    container.innerHTML = `<div class="error-banner">${esc(error.message)}</div>`;
  }
}
async function previewFile(file) {
  if (!state.importTable) {
    toast("Choose a destination table first.", true);
    return;
  }
  if (file.size > 10485760) {
    toast("Choose a file smaller than 10 MB.", true);
    return;
  }
  const table = state.importTable,
    generation = state.generation;
  state.importFile = null;
  const container = document.getElementById("upload-preview");
  container.innerHTML =
    '<div class="file-summary"><span class="spinner small-spinner"></span><p>Validating your file…</p></div>';
  try {
    const content = await file.text();
    const preview = await send(tablePath(table) + "/imports/preview", "POST", {
      filename: file.name,
      content,
    });
    if (generation !== state.generation || table !== state.importTable) return;
    state.importFile = { filename: file.name, content, table };
    container.innerHTML = `<div class="file-summary"><div><strong>${esc(file.name)}</strong><p>${fmt(preview.count)} records · ${bytes(file.size)} · ready to import</p></div>${statusTag("completed")}</div>${preview.items.length ? `<details><summary class="hint" style="cursor:pointer">Preview first ${preview.items.length} records</summary><pre class="code-block" tabindex="0">${esc(JSON.stringify(preview.items, null, 2))}</pre></details>` : ""}${button(`Import ${fmt(preview.count)} records`, "import-upload", "upload", "primary full-width mt")}`;
  } catch (error) {
    if (generation === state.generation)
      container.innerHTML = `<div class="error-banner mt">${esc(error.message)}</div>`;
  }
}
function renderActivity() {
  main.innerHTML =
    heading(
      "Activity",
      "A little history of what’s happened in your workspace.",
      button("Refresh", "refresh-activity", "refresh"),
    ) +
    `<section class="panel activity-full"><div class="panel-heading"><div><h2>Operation history <span class="count-badge">${state.operations.length}</span></h2><p>The latest 100 operations from this server session. Resets when the server restarts.</p></div><span class="tag">Live</span></div>${state.operations.length ? activityRows(state.operations, true) : empty("Your story starts here", "Create a table, edit an item, or import a file. Your operations and their outcomes will appear here.", `<a href="#tables" class="button primary">${icon("table")}Explore tables</a>`)}</section>`;
}
async function renderSettings(generation) {
  const data = await api("/api/settings");
  if (generation !== state.generation) return;
  const s = data.settings;
  main.innerHTML =
    heading(
      "Workspace settings",
      "The details behind your local development environment.",
    ) +
    `<div class="settings-grid"><section class="panel"><div class="panel-heading"><h2>Connection</h2>${icon("database")}</div><div class="panel-body"><div class="schema-row"><span>Endpoint</span><code>${esc(s.dynamodb_endpoint_url)}</code></div><div class="schema-row"><span>Data folder</span><code>${esc(s.data_path)}</code></div><div class="schema-row"><span>Log level</span><code>${esc(s.log_level)}</code></div><div class="schema-row"><span>Upload limit</span><span>${bytes(data.maxImportBytes)}</span></div><p class="info-note">Connection settings come from the container environment. Change the environment variables and restart the container to apply them. AWS credentials stay on the server.</p></div></section><section class="panel"><div class="panel-heading"><h2>Startup tasks</h2>${icon("play")}</div><div class="panel-body">${[
      ["delete_tables_on_startup", "Delete tables"],
      ["purge_tables_on_startup", "Purge tables"],
      ["create_tables_on_startup", "Create tables from schemas"],
      ["update_tables_on_startup", "Apply table updates"],
      ["seed_tables_on_startup", "Seed tables from files"],
    ]
      .map(
        ([key, label]) =>
          `<div class="schema-row"><span>${label}</span><span class="toggle-display ${s[key] ? "enabled" : ""}"><span class="pill" aria-hidden="true"></span>${s[key] ? "Enabled" : "Disabled"}</span></div>`,
      )
      .join(
        "",
      )}<p class="info-note">Tasks run in this order before the workspace opens. These indicators show your configuration; they are not switches.</p></div></section></div><div class="note-card">${icon("code")}<div><h3>Your workspace, in your workflow.</h3><p>Use the built-in <a href="/docs" target="_blank" rel="noopener" style="color:var(--purple)">API reference</a> to automate the same actions. This console is intended for trusted local development environments. Keep it bound to localhost.</p></div></div>`;
}
function openDialog(title, description, body, actions, context = {}) {
  dialogContext = context;
  dialog.classList.toggle("item-dialog", context.kind === "save-item");
  document.getElementById("dialog-content").innerHTML =
    `<form id="dialog-form"><div class="dialog-heading"><div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(description)}</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close dialog">${icon("close")}</button></div><div class="dialog-body">${body}<p class="form-error" id="dialog-error" role="alert"></p></div><div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">Cancel</button>${actions}</div></form>`;
  document
    .querySelectorAll("#dialog-content button[data-action]")
    .forEach((b) => (b.type = "button"));
  document.getElementById("dialog-form").onsubmit = submitDialog;
  if (!dialog.open) dialog.showModal();
  setTimeout(
    () => dialog.querySelector("input:not([type=hidden]),textarea")?.focus(),
    10,
  );
}
function createTableDialog(advanced = false) {
  const schema = {
    TableName: "my_table",
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  };
  openDialog(
    "Create a table",
    "Give your next idea a place to grow.",
    `<div class="dialog-tabs">${button("Quick setup", "create-guided", "table", !advanced ? "primary" : "")}${button("JSON schema", "create-advanced", "code", advanced ? "primary" : "")}</div>${advanced ? `<div class="field"><label for="schema-editor">DynamoDB CreateTable schema</label><textarea id="schema-editor" rows="16" spellcheck="false">${esc(JSON.stringify(schema, null, 2))}</textarea><small>Supports indexes, provisioned throughput, and other CreateTable options.</small></div>` : `<div class="field"><label for="new-table-name">Table name</label><input id="new-table-name" required minlength="3" maxlength="255" pattern="[a-zA-Z0-9_.-]+" placeholder="e.g. orders" autocomplete="off"><small>3–255 characters. Letters, numbers, underscores, dots, and hyphens.</small></div><div class="field-pair"><div class="field"><label for="new-pk">Partition key</label><input id="new-pk" value="pk" required placeholder="pk"></div><div class="field"><label for="pk-type">Type</label><select id="pk-type"><option value="S">String</option><option value="N">Number</option><option value="B">Binary</option></select></div></div><div class="field-pair"><div class="field"><label for="new-sk">Sort key <span class="muted">(optional)</span></label><input id="new-sk" placeholder="e.g. sk"></div><div class="field"><label for="sk-type">Type</label><select id="sk-type"><option value="S">String</option><option value="N">Number</option><option value="B">Binary</option></select></div></div><p class="editor-help">Uses on-demand capacity. Need indexes or provisioned throughput? Switch to JSON schema.</p>`}`,
    '<button class="button primary" type="submit">' +
      icon("plus") +
      "Create table</button>",
    { kind: advanced ? "create-advanced" : "create-table" },
  );
}
async function itemDialog(row = null) {
  const generation = state.generation;
  let item,
    originalKey = null;
  if (row !== null) {
    const key = keyOf(state.items[row]);
    item = await send(tablePath(state.table) + "/items/get", "POST", { key });
    if (generation !== state.generation) return;
    originalKey = keyOf(item);
  } else {
    const types = Object.fromEntries(
      state.detail.AttributeDefinitions.map((a) => [
        a.AttributeName,
        a.AttributeType,
      ]),
    );
    item = Object.fromEntries(
      state.detail.KeySchema.map((k) => [
        k.AttributeName,
        { [types[k.AttributeName]]: types[k.AttributeName] === "N" ? "0" : "" },
      ]),
    );
  }
  openDialog(
    row === null ? "Add an item" : "View & edit item",
    row === null
      ? `A new record for ${state.table}.`
      : `Edit attributes in ${state.table}. Primary keys stay fixed.`,
    `<div id="item-editor-views" class="item-editor-views" role="tablist" aria-label="Item editor views"></div><div class="item-editor-toolbar"><span id="item-editor-status" role="status"></span><div class="button-group"><button id="format-item" type="button" class="button small" data-action="format-item">${icon("code")}Format</button><button type="button" class="button small" data-action="validate-item">${icon("check")}Validate</button><button type="button" class="button small" data-action="copy-item">${icon("copy")}Copy JSON</button></div></div><div id="item-editor-panel" role="tabpanel"></div>${row !== null ? `<div class="button-group">${button("Delete item", "delete-item", "trash", "danger-outline small")}${button("Duplicate", "duplicate-item", "copy", "small")}</div>` : ""}`,
    `<button class="button primary" type="submit">${icon("check")}${row === null ? "Create item" : "Save changes"}</button>`,
    {
      kind: "save-item",
      originalKey,
      table: state.table,
      editor: { view: "ddb", item, ddb: JSON.stringify(item, null, 2) },
    },
  );
  renderItemEditor();
}
const itemTypes = {
  S: "String",
  N: "Number",
  BOOL: "Boolean",
  NULL: "Null",
  M: "Map",
  L: "List",
  SS: "String set",
  NS: "Number set",
  B: "Binary",
  BS: "Binary set",
};
function renderItemEditor() {
  const editor = dialogContext.editor;
  const views = [
    ["ddb", "DynamoDB JSON", "code"],
    ["json", "Standard JSON", "file"],
    ["attributes", "Attributes", "table"],
  ];
  document.getElementById("item-editor-views").innerHTML = views
    .map(
      ([id, label, ico]) =>
        `<button type="button" role="tab" id="editor-tab-${id}" aria-controls="item-editor-panel" aria-selected="${editor.view === id}" tabindex="${editor.view === id ? 0 : -1}" class="button ${editor.view === id ? "primary" : ""}" data-action="item-view" data-view="${id}">${icon(ico)}${label}</button>`,
    )
    .join("");
  const panel = document.getElementById("item-editor-panel");
  panel.setAttribute("aria-labelledby", "editor-tab-" + editor.view);
  if (editor.view === "attributes") {
    panel.innerHTML = `<div class="attribute-table"><div class="attribute-heading" aria-hidden="true"><span>Attribute</span><span>Type</span><span>Value</span><span></span></div><div id="attribute-rows"></div></div><button type="button" class="button small" data-action="add-attribute">${icon("plus")}Add attribute</button><p class="editor-help">Edit one attribute at a time. Maps and lists use nested DynamoDB JSON; sets use JSON arrays of strings. Binary values use base64.</p>`;
    for (const [name, attribute] of Object.entries(editor.item))
      appendAttributeRow(name, attribute);
  } else {
    const label = editor.view === "ddb" ? "DynamoDB JSON" : "Standard JSON";
    panel.innerHTML = `<div class="field"><label for="item-editor">${label}</label><div class="json-editor"><pre id="editor-lines" aria-hidden="true">1</pre><textarea id="item-editor" rows="17" spellcheck="false" wrap="off" aria-describedby="item-editor-help"></textarea></div></div><p class="editor-help" id="item-editor-help">${editor.view === "ddb" ? 'Explicit types keep every value unambiguous. Numbers use strings, e.g. <code>{"N":"1.25"}</code>. Format tidies your JSON; Validate checks types without saving.' : "Edit ordinary JSON with exact numbers. Existing sets stay sets and binary values stay base64 at their current paths. New arrays become lists. Change special types in Attributes or DynamoDB JSON."}</p>${editor.view === "ddb" ? '<details class="type-guide"><summary>DynamoDB type reference</summary><p><code>S</code> string · <code>N</code> number as a string · <code>BOOL</code> true/false · <code>NULL</code> true</p><p><code>M</code> map of typed attributes · <code>L</code> array of typed attributes</p><p><code>SS / NS / BS</code> nonempty arrays of strings · <code>B</code> base64 string</p></details>' : ""}`;
    const textarea = document.getElementById("item-editor");
    textarea.value = editor[editor.view];
    const updateLines = () => {
      document.getElementById("editor-lines").textContent = Array.from(
        { length: textarea.value.split("\n").length },
        (_, i) => i + 1,
      ).join("\n");
    };
    textarea.oninput = updateLines;
    textarea.onscroll = () =>
      (document.getElementById("editor-lines").scrollTop = textarea.scrollTop);
    updateLines();
  }
  document
    .getElementById("format-item")
    .classList.toggle("hidden", editor.view === "attributes");
  document.getElementById("item-editor-status").textContent =
    `${Object.keys(editor.item).length} attributes · Changes are saved only when you submit.`;
}
let attributeRowId = 0;
function appendAttributeRow(name = "", attribute = { S: "" }) {
  const [type, value] = Object.entries(attribute)[0];
  const id = ++attributeRowId;
  const locked = Object.hasOwn(dialogContext.originalKey || {}, name);
  const row = document.createElement("div");
  row.className = "attribute-row";
  row.innerHTML = `<div class="field"><label class="attribute-mobile-label" for="attr-name-${id}">Attribute</label><input id="attr-name-${id}" class="attribute-name" aria-label="Attribute name ${id}" placeholder="Attribute name" value="${esc(name)}" ${locked ? "readonly" : ""}>${locked ? '<span class="attribute-key">Primary key · fixed</span>' : ""}</div><div class="field"><label class="attribute-mobile-label" for="attr-type-${id}">Type</label><select id="attr-type-${id}" class="attribute-type" aria-label="Type for ${esc(name || "new attribute")}" ${locked ? "disabled" : ""}>${Object.entries(
    itemTypes,
  )
    .map(
      ([key, label]) =>
        `<option value="${key}" ${key === type ? "selected" : ""}>${esc(label)} (${key})</option>`,
    )
    .join(
      "",
    )}</select></div><div class="field attribute-value-field"></div><button type="button" class="icon-button" data-action="remove-attribute" aria-label="Remove ${esc(name || "attribute")}" ${locked ? "disabled" : ""}>${icon("trash")}</button>`;
  const renderValue = (kind, data) => {
    const field = row.querySelector(".attribute-value-field");
    const label = `Value for ${name || "new attribute"}`;
    const common = `id="attr-value-${id}" class="attribute-value" aria-label="${esc(label)}"`;
    field.innerHTML =
      `<label class="attribute-mobile-label" for="attr-value-${id}">Value</label>` +
      (kind === "BOOL"
        ? `<select ${common}><option value="true" ${data === true ? "selected" : ""}>true</option><option value="false" ${data === false ? "selected" : ""}>false</option></select>`
        : kind === "NULL"
          ? `<input ${common} value="null" readonly>`
          : `<textarea ${common} rows="${["M", "L"].includes(kind) ? 4 : 2}" spellcheck="false" ${locked ? "readonly" : ""}></textarea>`);
    if (!["BOOL", "NULL"].includes(kind))
      field.querySelector(".attribute-value").value = ["S", "N", "B"].includes(
        kind,
      )
        ? data
        : JSON.stringify(data, null, 2);
  };
  renderValue(type, value);
  row.querySelector(".attribute-type").onchange = (event) => {
    const next = event.target.value;
    const current = row.querySelector(".attribute-value").value;
    const defaults = {
      S: current,
      N: /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(current) ? current : "0",
      B: "",
      BOOL: false,
      NULL: true,
      M: {},
      L: [],
      SS: ["value"],
      NS: ["0"],
      BS: ["YQ=="],
    };
    renderValue(next, defaults[next]);
  };
  document.getElementById("attribute-rows").append(row);
  return row;
}
function itemEditorText() {
  if (dialogContext.editor.view !== "attributes")
    return document.getElementById("item-editor").value;
  const entries = [];
  const names = new Set();
  for (const row of document.querySelectorAll(".attribute-row")) {
    const name = row.querySelector(".attribute-name").value;
    if (!name)
      throw new Error(
        "Enter a name for every attribute, or remove the empty row.",
      );
    if (names.has(name)) throw new Error(`Duplicate attribute name: ${name}`);
    names.add(name);
    const type = row.querySelector(".attribute-type").value;
    const raw = row.querySelector(".attribute-value").value;
    // Leave nested JSON text intact for server validation, including duplicate keys.
    const value = ["S", "N", "B"].includes(type)
      ? JSON.stringify(raw)
      : type === "NULL"
        ? "true"
        : raw;
    entries.push(
      `${JSON.stringify(name)}: {${JSON.stringify(type)}: ${value}}`,
    );
  }
  return "{" + entries.join(",") + "}";
}
async function syncItemEditor() {
  const context = dialogContext;
  if (context.editor.busy)
    throw new Error("Please wait for validation to finish.");
  const text = itemEditorText();
  context.editor.busy = true;
  const controls = [
    ...dialog.querySelectorAll("input,textarea,select,button"),
  ].map((node) => [node, node.disabled]);
  controls.forEach(([node]) => (node.disabled = true));
  try {
    const result = await send("/api/items/convert", "POST", {
      text,
      view: context.editor.view === "json" ? "json" : "ddb",
      previous: context.editor.item,
    });
    if (dialogContext !== context || !dialog.open)
      throw new Error("The item editor was closed.");
    // Both raw and structured views obey the same immutable-key rule.
    if (
      context.originalKey &&
      Object.entries(context.originalKey).some(
        ([key, value]) =>
          JSON.stringify(result.item[key]) !== JSON.stringify(value),
      )
    )
      throw new Error(
        "Primary keys cannot be changed. Use Duplicate to create an item with new keys.",
      );
    Object.assign(context.editor, result);
    document.getElementById("dialog-error").textContent = "";
    return result.item;
  } finally {
    context.editor.busy = false;
    controls.forEach(([node, disabled]) => (node.disabled = disabled));
  }
}
async function itemEditorAction(name, target) {
  try {
    if (name === "remove-attribute") {
      target.closest(".attribute-row").remove();
      return;
    }
    if (name === "add-attribute") {
      appendAttributeRow().querySelector("input").focus();
      return;
    }
    await syncItemEditor();
    if (name === "item-view") {
      dialogContext.editor.view = target.dataset.view;
      renderItemEditor();
      document.getElementById("editor-tab-" + target.dataset.view).focus();
    } else if (name === "format-item") renderItemEditor();
    else if (name === "validate-item")
      document.getElementById("item-editor-status").textContent =
        "Valid DynamoDB item · Nothing saved yet.";
    else if (name === "copy-item")
      await copyText(
        dialogContext.editor.view === "json"
          ? dialogContext.editor.json
          : dialogContext.editor.ddb,
      );
  } catch (error) {
    if (dialog.open)
      document.getElementById("dialog-error").textContent = error.message;
  }
}

function confirmTable(kind) {
  const purge = kind === "purge";
  openDialog(
    purge ? "Purge all items?" : "Delete this table?",
    purge
      ? "The schema stays. Every item goes. This cannot be undone."
      : "The table, its items, and its indexes will be permanently removed.",
    `<div class="error-banner">${purge ? "All items in" : "Everything in"} <strong>${esc(state.table)}</strong> will be deleted.</div><div class="field"><label for="confirmation">Type <strong>${esc(state.table)}</strong> to confirm</label><input id="confirmation" autocomplete="off" required></div>`,
    `<button class="button danger" type="submit">${icon("trash")}${purge ? "Purge all items" : "Delete table"}</button>`,
    { kind, table: state.table },
  );
}
function updateSchemaDialog() {
  openDialog(
    "Update table schema",
    "Adjust capacity or manage global secondary indexes.",
    `<div class="field"><label for="schema-editor">DynamoDB UpdateTable schema</label><textarea id="schema-editor" rows="14" spellcheck="false">${esc(JSON.stringify({ TableName: state.table, BillingMode: "PAY_PER_REQUEST" }, null, 2))}</textarea></div><p class="editor-help">Use <code>GlobalSecondaryIndexUpdates</code> to add, modify, or remove an index. The full table definition in the Schema tab is a description, not an update request.</p>`,
    `<button class="button primary" type="submit">${icon("check")}Apply update</button>`,
    { kind: "update-schema", table: state.table },
  );
}
async function submitDialog(event) {
  event.preventDefault();
  const context = dialogContext;
  const submit = dialog.querySelector("button[type=submit]");
  submit.disabled = true;
  document.getElementById("dialog-error").textContent = "";
  try {
    if (await submitWorkspaceDialog(context)) return;
    if (["save-query", "delete-saved-query"].includes(context.kind)) {
      submitSavedQuery(context);
      return;
    }
    let operation;
    if (context.kind === "create-table" || context.kind === "create-advanced") {
      let definition;
      if (context.kind === "create-advanced")
        definition = JSON.parse(document.getElementById("schema-editor").value);
      else {
        const name = document.getElementById("new-table-name").value.trim(),
          pk = document.getElementById("new-pk").value.trim(),
          sk = document.getElementById("new-sk").value.trim();
        if (!pk) throw new Error("Enter a partition key.");
        if (pk === sk)
          throw new Error("Partition and sort keys must have different names.");
        definition = {
          TableName: name,
          BillingMode: "PAY_PER_REQUEST",
          KeySchema: [{ AttributeName: pk, KeyType: "HASH" }],
          AttributeDefinitions: [
            {
              AttributeName: pk,
              AttributeType: document.getElementById("pk-type").value,
            },
          ],
        };
        if (sk) {
          definition.KeySchema.push({ AttributeName: sk, KeyType: "RANGE" });
          definition.AttributeDefinitions.push({
            AttributeName: sk,
            AttributeType: document.getElementById("sk-type").value,
          });
        }
      }
      operation = await send("/api/tables", "POST", { definition });
    } else if (context.kind === "update-schema") {
      operation = await send(tablePath(context.table), "PATCH", {
        definition: JSON.parse(document.getElementById("schema-editor").value),
      });
    } else if (context.kind === "purge" || context.kind === "delete") {
      const confirmation = document.getElementById("confirmation").value;
      if (confirmation !== context.table)
        throw new Error(
          "The table name does not match. Please type it exactly.",
        );
      operation = await send(
        tablePath(context.table) + (context.kind === "purge" ? "/purge" : ""),
        context.kind === "purge" ? "POST" : "DELETE",
        { confirmation },
      );
    } else if (context.kind === "save-item") {
      const item = await syncItemEditor();
      await send(tablePath(context.table) + "/items", "PUT", {
        item,
        originalKey: context.originalKey,
        createOnly: true,
      });
      dialog.close();
      toast(context.originalKey ? "Item updated." : "Item created.");
      if (state.table === context.table && state.detailTab === "items")
        await loadItems();
      await refreshOperations();
      return;
    } else if (context.kind === "delete-item") {
      await send(tablePath(context.table) + "/items", "DELETE", {
        key: context.key,
      });
      dialog.close();
      toast("Item deleted.");
      if (state.table === context.table && state.detailTab === "items")
        await loadItems();
      await refreshOperations();
      return;
    } else if (context.kind === "mounted") {
      operation = await send(
        tablePath(context.table) + "/imports/mounted",
        "POST",
        { filename: context.filename },
      );
    }
    if (operation) {
      dialog.close();
      startedOperation(operation);
      if (context.kind === "delete") location.hash = "#tables";
    }
  } catch (error) {
    document.getElementById("dialog-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}
function startedOperation(operation) {
  state.operations.unshift(operation);
  toast(operation.action + " queued. Follow its progress in Activity.");
  document.getElementById("activity-dot").className = "live-dot";
  refreshOperations();
}
async function refreshOperations() {
  try {
    const operations = await api("/api/operations");
    const completed = operations.filter(
      (o) =>
        ["completed", "failed"].includes(o.status) &&
        state.operations.some(
          (old) =>
            old.id === o.id && ["queued", "running"].includes(old.status),
        ),
    );
    state.operations = operations;
    document.getElementById("activity-dot").className = operations.some((o) =>
      ["queued", "running"].includes(o.status),
    )
      ? "live-dot"
      : "";
    if (state.route === "activity") renderActivity();
    for (const job of completed)
      toast(
        job.status === "failed"
          ? `${job.action} failed: ${job.detail}`
          : `${job.action} completed${job.table ? " · " + job.table : ""}`,
        job.status === "failed",
      );
    if (completed.length) {
      await refreshOverview(false);
      if (
        !dialog.open &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          document.activeElement.tagName,
        )
      ) {
        if (state.route === "overview") renderOverview();
        else if (state.route === "tables" && !state.table) renderTables();
        else if (
          state.route === "tables" &&
          state.detailTab === "items" &&
          state.search.mode === "scan" &&
          !state.busy &&
          completed.some(
            (job) =>
              job.table === state.table &&
              ["Import data", "Purge table"].includes(job.action),
          ) &&
          state.overview.tables.some((t) => t.TableName === state.table)
        )
          await loadItems();
      }
    }
  } catch {
    /* Connection errors are shown by workspace refresh; polling should not interrupt editing. */
  }
}
async function exportTable() {
  const name = state.table;
  toast("Preparing your DynamoDB JSON export…");
  const response = await fetch(tablePath(name) + "/export");
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.detail || "Export failed");
  }
  const blob = await response.blob(),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name + ".dynamodb.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Export downloaded. It can be imported without losing types.");
  await refreshOperations();
}
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    toast("JSON copied to clipboard.");
  } else {
    throw new Error(
      "Clipboard is unavailable in this browser. Select and copy the JSON instead.",
    );
  }
}
async function action(event) {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  const name = target.dataset.action;
  try {
    if (await workspaceAction(name, target)) return;
    if (
      [
        "item-view",
        "format-item",
        "validate-item",
        "copy-item",
        "add-attribute",
        "remove-attribute",
      ].includes(name)
    )
      await itemEditorAction(name, target);
    else if (name === "save-query") saveQueryDialog();
    else if (name === "manage-query") saveQueryDialog(true);
    else if (name === "load-query") await loadSavedQuery();
    else if (name === "delete-saved-query") {
      const context = dialogContext;
      openDialog(
        "Delete saved query?",
        `Remove “${context.saved.name}” from this browser?`,
        '<p class="editor-help">Your table and its data will stay unchanged.</p>',
        '<button class="button danger" type="submit">Delete saved query</button>',
        { ...context, kind: "delete-saved-query" },
      );
    } else if (name === "refresh") await refreshOverview();
    else if (name === "create-table" || name === "create-guided")
      createTableDialog();
    else if (name === "create-advanced") createTableDialog(true);
    else if (name === "close-dialog") dialog.close();
    else if (name === "add-item") await itemDialog();
    else if (name === "edit-item") await itemDialog(Number(target.dataset.row));
    else if (name === "detail-tab") {
      state.detailTab = target.dataset.tab;
      await renderDetailTab();
    } else if (name === "reload-items") await loadItems();
    else if (name === "next-page") {
      state.cursors[state.page] = state.nextCursor;
      state.page++;
      await loadItems();
    } else if (name === "prev-page") {
      state.page--;
      await loadItems();
    } else if (name === "export") {
      target.disabled = true;
      try {
        await exportTable();
      } finally {
        target.disabled = false;
      }
    } else if (name === "purge-table") confirmTable("purge");
    else if (name === "delete-table") confirmTable("delete");
    else if (name === "update-schema") updateSchemaDialog();
    else if (name === "copy-schema")
      await copyText(JSON.stringify(state.detail, null, 2));
    else if (name === "refresh-activity") await refreshOperations();
    else if (name === "import-upload") {
      const file = state.importFile;
      if (!file || file.table !== state.importTable)
        throw new Error("Choose and preview a file first.");
      target.disabled = true;
      try {
        const operation = await send(
          tablePath(file.table) + "/imports",
          "POST",
          { filename: file.filename, content: file.content },
        );
        startedOperation(operation);
        state.importFile = null;
        document.getElementById("upload-preview").innerHTML =
          '<div class="file-summary"><p>Import queued. <a href="#activity" style="color:var(--purple)">View activity →</a></p></div>';
      } finally {
        target.disabled = false;
      }
    } else if (name === "load-mounted") {
      openDialog(
        "Load mounted file?",
        `Import ${target.dataset.file} into ${state.importTable}.`,
        `<p class="editor-help">Items with matching keys will be replaced. The file is validated before the operation is queued. If a write later fails, earlier batches may remain.</p>`,
        `<button class="button primary" type="submit">${icon("upload")}Load file</button>`,
        {
          kind: "mounted",
          filename: target.dataset.file,
          table: state.importTable,
        },
      );
    } else if (name === "delete-item") {
      const context = dialogContext;
      openDialog(
        "Delete this item?",
        "This record will be permanently removed.",
        `<pre class="code-block" tabindex="0">${esc(JSON.stringify(context.originalKey, null, 2))}</pre>`,
        `<button class="button danger" type="submit">${icon("trash")}Delete item</button>`,
        { kind: "delete-item", key: context.originalKey, table: context.table },
      );
    } else if (name === "duplicate-item") {
      dialogContext.originalKey = null;
      document.getElementById("dialog-title").textContent = "Duplicate item";
      document.querySelector("#dialog-form .dialog-heading p").textContent =
        "Change at least one primary key to create a separate item.";
      document.querySelector("[data-action=delete-item]").remove();
      target.remove();
      document.querySelector("#dialog-form button[type=submit]").innerHTML =
        icon("plus") + "Create duplicate";
      if (dialogContext.editor.view === "attributes") {
        await syncItemEditor();
        renderItemEditor();
      }
      document
        .querySelector("#item-editor-panel input, #item-editor-panel textarea")
        ?.focus();
    }
  } catch (error) {
    toast(error.message, true);
  }
}
dialog.addEventListener("input", () => {
  if (dialogContext?.kind === "save-item") {
    document.getElementById("item-editor-status").textContent =
      "Draft edited · Validate or save to check your changes.";
  }
});
document.addEventListener("click", action);
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
document.getElementById("refresh").onclick = () => refreshOverview();
function setSidebar(open) {
  document.getElementById("sidebar").classList.toggle("open", open);
  document.getElementById("sidebar").inert =
    matchMedia("(max-width:700px)").matches && !open;
  document
    .getElementById("menu-toggle")
    .setAttribute("aria-expanded", String(open));
}
document.getElementById("menu-toggle").onclick = () =>
  setSidebar(!document.getElementById("sidebar").classList.contains("open"));
matchMedia("(max-width:700px)").addEventListener("change", () =>
  setSidebar(false),
);
document.addEventListener("keydown", (event) => {
  if (
    document.activeElement.getAttribute("role") === "tab" &&
    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  ) {
    event.preventDefault();
    const tabs = [
      ...document.activeElement
        .closest('[role="tablist"]')
        .querySelectorAll("[role=tab]"),
    ];
    const i = tabs.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    tabs[next].focus();
    tabs[next].click();
  }
  if (
    event.key === "/" &&
    !dialog.open &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
  ) {
    const field =
      document.getElementById("table-filter") ||
      document.getElementById("item-filter");
    if (field) {
      event.preventDefault();
      field.focus();
    }
  }
  if (event.key === "Escape") {
    setSidebar(false);
  }
});
window.addEventListener("hashchange", navigate);
window.addEventListener("online", () => refreshOverview(false));
setInterval(() => {
  if (!document.hidden) refreshOperations();
}, 2500);
navigate();

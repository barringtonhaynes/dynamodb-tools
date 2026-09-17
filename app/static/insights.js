// Token highlighting never parses numbers or inserts unescaped user content.
function highlightJSON(text) {
  const token =
    /"(?:\\[\s\S]|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let result = "",
    start = 0;
  for (const match of text.matchAll(token)) {
    result += esc(text.slice(start, match.index));
    const value = match[0];
    const kind =
      value[0] === '"'
        ? /^\s*:/.test(text.slice(match.index + value.length))
          ? "key"
          : "string"
        : /^(true|false|null)$/.test(value)
          ? "literal"
          : "number";
    result += `<span class="json-${kind}">${esc(value)}</span>`;
    start = match.index + value.length;
  }
  return result + esc(text.slice(start));
}
function enhanceJSON(textarea) {
  if (!textarea || textarea.closest(".syntax-input")) return;
  const wrap = document.createElement("div");
  wrap.className = "syntax-input";
  textarea.before(wrap);
  const pre = document.createElement("pre");
  pre.className = "syntax-paint";
  pre.setAttribute("aria-hidden", "true");
  wrap.append(pre, textarea);
  textarea.wrap = "off";
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocomplete", "off");
  const paint = () => {
    pre.innerHTML = highlightJSON(textarea.value) + "\n";
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  };
  textarea.addEventListener("input", paint);
  textarea.addEventListener("scroll", paint);
  paint();
}
function itemContractKey() {
  return savedQueryKey() + ":item-schema";
}
function readItemContract() {
  try {
    return workspaceStorage.getItem(itemContractKey()) || "";
  } catch {
    return "";
  }
}
function editorInsights(result) {
  const node = document.getElementById("item-insights");
  if (!node) return;
  const metrics = result.metrics;
  const checks = result.checks || { errors: [], indexes: [] };
  node.innerHTML = `<div class="item-size-summary"><strong>${fmt(metrics.estimatedBytes)} bytes <span class="muted">estimated item size</span></strong><span>${bytes(metrics.jsonBytes)} compact DynamoDB JSON</span>${dialogContext.readCapacity !== undefined ? `<span>${dialogContext.readCapacity} read capacity units</span>` : ""}<span>${((metrics.estimatedBytes / metrics.limitBytes) * 100).toFixed(2)}% of 400 KiB</span></div><meter min="0" max="${metrics.limitBytes}" value="${Math.min(metrics.estimatedBytes, metrics.limitBytes)}" aria-label="Estimated item size out of 400 KiB"></meter><p class="info-note">Number sizes are approximate. Excludes storage overhead; projections and indexes affect storage and capacity. DynamoDB enforces the final size limit.</p>${result.warnings?.map((w) => `<p class="form-error">${esc(w)}</p>`).join("") || ""}${checks.errors.length ? `<div class="error-banner">${checks.errors.map(esc).join("<br>")}</div>` : '<p class="validation-ok">Types and key schema checked.</p>'}<div class="index-membership">${checks.indexes.map((i) => `<span class="tag" title="${esc(i.missing.length ? "Missing: " + i.missing.join(", ") : "All index keys present")}">${esc(i.name)} · ${i.status === "included" ? "eligible for index" : i.status === "excluded" ? "excluded (sparse)" : "invalid key"}</span>`).join("")}</div><details><summary>Size by attribute</summary><div class="size-attributes">${metrics.attributes.map((a) => `<div><code>${esc(a.name)}</code><span>${fmt(a.bytes)} B</span></div>`).join("")}</div></details>`;
}
function markEditorInsightsStale() {
  const node = document.getElementById("item-insights");
  if (node)
    node.innerHTML =
      '<p class="info-note">Draft changed. Validate to refresh size, key checks, and index membership.</p>';
}
let modelState = null;
function renderModel() {
  modelState = { table: state.table, cursor: null, page: 0, result: null };
  document.getElementById("detail-content").innerHTML =
    `<section class="panel"><div class="panel-heading"><div><h2>Understand your data model</h2><p>Explore entity types, composite keys, and sparse indexes.</p></div>${icon("layers")}</div><div class="panel-body"><div class="model-controls"><div class="field"><label for="model-entity">Entity type attribute</label><input id="model-entity" value="entityType" maxlength="255"></div><div class="field"><label for="model-delimiter">Key delimiter</label><input id="model-delimiter" value="#" maxlength="8"></div>${button("Read sample", "model-read", "play", "primary")}${button("Next sample", "model-next", "arrow")}</div><p class="info-note">Each sample scans up to 100 items or 1 MiB. Counts describe this page only, and consume read capacity. Entity names fall back to sort-key prefixes when the selected attribute is absent. Samples are not a consistent snapshot.</p><div id="model-results" aria-live="polite"></div></div></section><section class="panel mt"><div class="panel-heading"><div><h2>Composite key workbench</h2><p>Build a partition lookup or a related-item prefix query.</p></div></div><div class="panel-body"><div class="model-controls"><div class="field"><label for="pattern-index">Table / index</label><select id="pattern-index"><option value="">Primary index</option>${[...(state.detail.GlobalSecondaryIndexes || []), ...(state.detail.LocalSecondaryIndexes || [])].map((i) => `<option value="${esc(i.IndexName)}">${esc(i.IndexName)}</option>`).join("")}</select></div><div class="field"><label for="pattern-pk">Partition key value</label><input id="pattern-pk" placeholder="CUSTOMER#123"></div><div class="field"><label for="pattern-sk">Sort key prefix (optional)</label><input id="pattern-sk" placeholder="ORDER#2026-09"></div>${button("Open query", "pattern-query", "search")}</div><p class="info-note" id="pattern-help">Use the full partition key and an optional string sort-key prefix. For example, CUSTOMER#123 + ORDER# retrieves that customer’s orders. You can save the query in Items.</p><details class="type-guide"><summary>Designing sparse indexes and entity types</summary><p>A sparse index contains only items with all its key attributes. For example, give open orders an <code>openOrderKey</code> of <code>OPEN</code>; remove that attribute when fulfilled. Add the GSI in Schema &amp; indexes, then inspect membership here.</p><p>Store an <code>entityType</code> such as <code>Customer</code> or <code>Order</code> to describe each record. Use the item editor’s optional JSON Schema with <code>if</code>/<code>then</code> rules for entity-specific validation.</p><p>Prefix lookups match from the left. Filters run after reads; an appropriate key query avoids scanning unrelated records. A constant index partition key can become hot at scale.</p></details></div></section>`;
  document.querySelector('[data-action="model-next"]').disabled = true;
}
async function readModel(next = false) {
  const current = modelState;
  const entityAttribute = document.getElementById("model-entity").value;
  const delimiter = document.getElementById("model-delimiter").value;
  if (!entityAttribute || !delimiter)
    throw new Error("Enter an entity attribute and key delimiter.");
  if (
    next &&
    (current.entityAttribute !== entityAttribute ||
      current.delimiter !== delimiter)
  )
    throw new Error("Settings changed. Read a fresh sample first.");
  const buttons = [
    ...document.querySelectorAll(
      '[data-action="model-read"],[data-action="model-next"]',
    ),
  ];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const result = await send(tablePath(current.table) + "/model", "POST", {
      entityAttribute,
      delimiter,
      cursor: next ? current.cursor : null,
    });
    if (
      modelState !== current ||
      state.table !== current.table ||
      state.detailTab !== "model"
    )
      return;
    Object.assign(current, {
      result,
      cursor: result.cursor,
      entityAttribute,
      delimiter,
      page: next ? current.page + 1 : 1,
    });
    const rows = result.entities
      .map(
        (e) =>
          `<tr><td><strong>${esc(e.name)}</strong></td><td>${fmt(e.count)}</td><td>${bytes(e.bytes)}</td><td>${Object.entries(
            e.attributes,
          )
            .map(
              ([name, a]) =>
                `<span class="model-attribute"><code>${esc(name)}</code> ${esc(a.types.join(" / "))} · ${a.count}/${e.count}</span>`,
            )
            .join("")}</td></tr>`,
      )
      .join("");
    document.getElementById("model-results").innerHTML =
      `<div class="model-summary"><span class="tag purple">Sample ${current.page}</span><strong>${result.count} items</strong><span>${bytes(result.bytes)} estimated</span><span>${result.capacity} read capacity units</span></div>${result.count ? `<h3>Observed entity types</h3><div class="table-wrap" tabindex="0" role="region" aria-label="Entity observations"><table class="data-table"><thead><tr><th>Entity / inferred prefix</th><th>Items</th><th>Est. bytes</th><th>Attributes · type · presence</th></tr></thead><tbody>${rows}</tbody></table></div><h3>Key patterns</h3><div class="pattern-grid">${result.patterns.map((p) => `<div><code>${esc(p.partition)}</code><span>→</span><code>${esc(p.sort)}</code><span class="tag">${p.count}</span></div>`).join("")}</div>` : '<p class="info-note">No items in this sample.</p>'}<h3>Sparse index coverage</h3><div class="model-indexes">${
        result.indexes
          .map(
            (i, n) =>
              `<div class="model-index"><strong>${esc(i.name)}</strong><p>${i.included} eligible · ${i.excluded} excluded · ${i.invalid} invalid</p><meter min="0" max="${Math.max(1, result.count)}" value="${i.included}" aria-label="${esc(i.name)} eligible items in sample"></meter><p class="info-note">${
                Object.entries(i.missing)
                  .map(([key, count]) => `${esc(key)} absent in ${count}`)
                  .join(" · ") || "No missing index keys in this sample."
              }</p>${i.examples.map((key, j) => `<button type="button" class="button small" data-action="model-index-query" data-index="${n}" data-key="${j}">Query ${esc(attrDisplay(key))}</button>`).join("")}</div>`,
          )
          .join("") ||
        '<p class="info-note">No secondary indexes. Add one in Schema &amp; indexes.</p>'
      }</div><h3>Partition collections in this sample</h3><div class="partition-list">${result.partitions.map((p, i) => `<div><strong class="mono">${esc(attrDisplay(p.key))}</strong><span>${p.count} items · ${bytes(p.bytes)} est.</span><div class="button-group"><button class="button small" type="button" data-action="model-partition" data-row="${i}">Query partition</button>${p.prefixes.map((prefix, j) => `<button class="button small" type="button" data-action="model-prefix" data-row="${i}" data-prefix="${j}">${esc(prefix)}…</button>`).join("")}</div></div>`).join("")}</div><p class="info-note">Eligibility is based on sampled base-table attributes. It does not confirm index backfill or propagation, and sample counts do not measure traffic or hot partitions.</p>`;
  } finally {
    if (modelState === current && state.detailTab === "model") {
      buttons[0].disabled = false;
      buttons[1].disabled = !current.cursor;
    }
  }
}
async function openPatternQuery(partition, sort = null, index = null) {
  state.search = {
    mode: "query",
    index,
    partition,
    sort,
    operator: sort ? "begins_with" : "=",
    limit: 25,
    ascending: true,
  };
  state.page = 1;
  state.cursors = [null];
  state.savedQueryId = null;
  state.detailTab = "items";
  await renderDetailTab();
}
async function insightsAction(name, target) {
  if (name === "model-read" || name === "model-next")
    await readModel(name === "model-next");
  else if (name === "model-partition" || name === "model-prefix") {
    const p = modelState.result.partitions[Number(target.dataset.row)];
    await openPatternQuery(
      p.key,
      name === "model-prefix"
        ? { S: p.prefixes[Number(target.dataset.prefix)] }
        : null,
    );
  } else if (name === "model-index-query") {
    const i = modelState.result.indexes[Number(target.dataset.index)];
    await openPatternQuery(
      i.examples[Number(target.dataset.key)],
      null,
      i.name,
    );
  } else if (name === "pattern-query") {
    const index = document.getElementById("pattern-index").value || null;
    const schema = keySchema(state.detail, index);
    const types = Object.fromEntries(
      state.detail.AttributeDefinitions.map((a) => [
        a.AttributeName,
        a.AttributeType,
      ]),
    );
    const pk = schema.find((k) => k.KeyType === "HASH").AttributeName;
    const sk = schema.find((k) => k.KeyType === "RANGE")?.AttributeName;
    const value = document.getElementById("pattern-pk").value;
    const prefix = document.getElementById("pattern-sk").value;
    if (!value) throw new Error("Enter the complete partition key value.");
    if (prefix && (!sk || types[sk] !== "S"))
      throw new Error(
        "This workbench supports prefixes on string sort keys. Use Items for numeric or binary conditions.",
      );
    await openPatternQuery(
      { [types[pk]]: value },
      prefix ? { S: prefix } : null,
      index,
    );
  } else if (name === "save-item-schema") {
    const text = document.getElementById("item-schema").value;
    // Validate schema and the current draft before persisting the contract.
    await syncItemEditor();
    await workspaceStorage.setItem(itemContractKey(), text);
    toast(
      workspaceStorage.installed
        ? "Item schema saved for this table on this computer."
        : "Item schema saved for this table in this browser.",
    );
  } else return false;
  return true;
}

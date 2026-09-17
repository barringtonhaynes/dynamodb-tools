let plannerState = null;
let plannerRow = 0;
const plannerOperators = {
  "=": "equals",
  "<>": "not equal",
  begins_with: "starts with",
  between: "between",
  "<": "less than",
  "<=": "at most",
  ">": "greater than",
  ">=": "at least",
  exists: "exists",
  not_exists: "does not exist",
};
function renderQueryPlanner() {
  const table = state.table;
  if (plannerState?.table !== table)
    plannerState = { table, result: null, input: null };
  const fields = state.detail.AttributeDefinitions.map(
    (a) => `<option value="${esc(a.AttributeName)}"></option>`,
  ).join("");
  const last = state.lastRead?.table === table ? state.lastRead : null;
  const discard = last?.scanned
    ? Math.round(100 * (1 - last.count / last.scanned))
    : null;
  document.getElementById("detail-content").innerHTML =
    `<section class="panel"><div class="panel-heading"><div><h2>Access-pattern query builder</h2><p>Describe what you need. Compare the table and every index before reading data.</p></div>${icon("search")}</div><form id="planner-form" class="panel-body"><div class="planner-intro"><label class="field" for="planner-template">Start from a pattern<select id="planner-template"><option value="custom">Custom lookup</option><option value="collection">Single-table entity collection</option><option value="sparse">Sparse tenant work queue</option><option value="inverted">Inverted relationship lookup</option></select></label><button class="button" type="button" id="planner-current">Use current Items query</button></div><p class="info-note" id="planner-pattern-help">Conditions are combined with AND. Attribute names are literal, including dots. No reads run when you compare plans.</p><datalist id="planner-attributes">${fields}</datalist><div id="planner-conditions"></div><button class="button small" type="button" id="planner-add">${icon("plus")}Add condition</button><div class="field-pair mt"><div class="field"><label for="planner-projection">Returned attributes · one per line</label><textarea id="planner-projection" rows="3" placeholder="Blank requires all table attributes"></textarea></div><div><div class="field"><label for="planner-order">Required result order (optional attribute)</label><input id="planner-order" list="planner-attributes" placeholder="e.g. createdAt"></div><label class="planner-check"><input type="checkbox" id="planner-descending">Descending order</label></div></div><label class="planner-check"><input type="checkbox" id="planner-consistent">Require strongly consistent reads</label><label class="planner-check"><input type="checkbox" id="planner-sparse">Allow indexed-items-only results when an index can omit matching items</label><details class="type-guide"><summary>Propose an index design</summary><p>Choose attributes from your conditions. The partition attribute must use equality. A proposal is an editable design, not a schema change.</p><div class="field-pair"><div class="field"><label for="planner-draft-pk">Proposed partition attribute</label><input id="planner-draft-pk" list="planner-attributes" placeholder="e.g. openCustomerKey"></div><div class="field"><label for="planner-draft-sk">Proposed sort attribute (optional)</label><input id="planner-draft-sk" list="planner-attributes" placeholder="e.g. createdAt"></div></div></details><p id="planner-error" class="form-error" role="alert"></p><button class="button primary" type="submit">${icon("search")}Compare access paths</button></form></section>${last ? `<section class="panel mt"><div class="panel-heading"><div><h2>Last measured read</h2><p>${esc(last.index || "Base table")} · ${esc(last.mode)} · one response page</p></div></div><div class="panel-body"><div class="model-summary"><strong>${fmt(last.scanned)} evaluated</strong><span>${fmt(last.count)} returned</span><span>${last.capacity} RCU</span><span>${discard === null ? "No evaluated items" : discard + "% discarded by server filters"}</span></div><p class="info-note">${discard > 50 ? "Many evaluated items were discarded. Look for a plan that moves a frequent filter into the key condition. " : ""}This measures the last read only. Page filters in the UI are separate. It does not predict savings or identify hot partitions.</p></div></section>` : ""}<div id="planner-results" aria-live="polite"></div>`;
  const form = document.getElementById("planner-form");
  form.onsubmit = compareQueryPlans;
  document.getElementById("planner-add").onclick = () => {
    addPlannerCondition();
    form.dispatchEvent(new Event("input"));
  };
  document.getElementById("planner-current").onclick = () => {
    try {
      fillPlannerFromItems();
    } catch (error) {
      document.getElementById("planner-error").textContent = error.message;
    }
  };
  document.getElementById("planner-template").onchange = applyPlannerTemplate;
  form.addEventListener("input", () => {
    plannerState.input = readPlanner();
    plannerState.result = null;
    document.getElementById("planner-results").innerHTML =
      '<p class="info-note">Pattern changed. Compare again to refresh the plans.</p>';
  });
  if (plannerState.input) fillPlanner(plannerState.input);
  else
    addPlannerCondition({
      attribute: state.detail.KeySchema.find((k) => k.KeyType === "HASH")
        .AttributeName,
    });
}
function addPlannerCondition(rule = {}) {
  const host = document.getElementById("planner-conditions");
  if (host.children.length >= 20) return;
  const id = ++plannerRow;
  const row = document.createElement("div");
  row.className = "planner-condition";
  row.innerHTML = `<div class="field"><label for="plan-attr-${id}">Attribute</label><input id="plan-attr-${id}" class="plan-attribute" list="planner-attributes" required maxlength="255" value="${esc(rule.attribute || "")}"></div><div class="field"><label for="plan-op-${id}">Condition</label><select id="plan-op-${id}" class="plan-operator">${Object.entries(
    plannerOperators,
  )
    .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
    .join(
      "",
    )}</select></div><div class="field plan-value-field"><label for="plan-type-${id}">Type</label><select id="plan-type-${id}" class="plan-type"><option value="S">String</option><option value="N">Number</option><option value="B">Binary (base64)</option></select></div><div class="field plan-value-field"><label for="plan-value-${id}">Value</label><input id="plan-value-${id}" class="plan-value" maxlength="4096" value="${esc(rule.value ? Object.values(rule.value)[0] : "")}"></div><div class="field plan-end-field"><label for="plan-end-${id}">Range end</label><input id="plan-end-${id}" class="plan-end" maxlength="4096" value="${esc(rule.end ? Object.values(rule.end)[0] : "")}"></div><button type="button" class="icon-button" aria-label="Remove condition ${id}">${icon("close")}</button>`;
  row.querySelector(".plan-operator").value = rule.operator || "=";
  row.querySelector(".plan-type").value = rule.value
    ? Object.keys(rule.value)[0]
    : state.detail.AttributeDefinitions.find(
        (a) => a.AttributeName === rule.attribute,
      )?.AttributeType || "S";
  const update = () => {
    const op = row.querySelector(".plan-operator").value;
    row
      .querySelectorAll(".plan-value-field")
      .forEach((el) => (el.hidden = ["exists", "not_exists"].includes(op)));
    row.querySelector(".plan-end-field").hidden = op !== "between";
  };
  row.querySelector(".plan-operator").onchange = update;
  row.querySelector("button").onclick = () => {
    row.remove();
    document.getElementById("planner-form").dispatchEvent(new Event("input"));
  };
  update();
  host.append(row);
  if (!rule.attribute) row.querySelector("input").focus();
}
function readPlanner() {
  return {
    conditions: [...document.querySelectorAll(".planner-condition")].map(
      (row) => {
        const rule = {
          attribute: row.querySelector(".plan-attribute").value,
          operator: row.querySelector(".plan-operator").value,
        };
        const kind = row.querySelector(".plan-type").value;
        if (!["exists", "not_exists"].includes(rule.operator))
          rule.value = { [kind]: row.querySelector(".plan-value").value };
        if (rule.operator === "between")
          rule.end = { [kind]: row.querySelector(".plan-end").value };
        return rule;
      },
    ),
    projection: document
      .getElementById("planner-projection")
      .value.split("\n")
      .map((v) => v.trim())
      .filter(Boolean),
    orderBy: document.getElementById("planner-order").value,
    ascending: !document.getElementById("planner-descending").checked,
    consistent: document.getElementById("planner-consistent").checked,
    allowSparse: document.getElementById("planner-sparse").checked,
    draftPartition: document.getElementById("planner-draft-pk").value,
    draftSort: document.getElementById("planner-draft-sk").value,
  };
}
function fillPlanner(input) {
  document.getElementById("planner-conditions").innerHTML = "";
  input.conditions.forEach(addPlannerCondition);
  document.getElementById("planner-projection").value = (
    input.projection || []
  ).join("\n");
  document.getElementById("planner-order").value = input.orderBy || "";
  document.getElementById("planner-consistent").checked =
    input.consistent || false;
  document.getElementById("planner-sparse").checked =
    input.allowSparse || false;
  document.getElementById("planner-descending").checked =
    input.ascending === false;
  document.getElementById("planner-draft-pk").value =
    input.draftPartition || "";
  document.getElementById("planner-draft-sk").value = input.draftSort || "";
  plannerState.input = input;
}
function fillPlannerFromItems() {
  const q = state.search;
  if (q.filterExpression || (q.filterJoin === "OR" && q.filters?.length > 1))
    throw new Error(
      "Advanced expressions and OR conditions need manual review. Enter an equivalent AND access pattern here.",
    );
  const conditions = (q.filters || []).map((rule) => ({ ...rule }));
  if (
    conditions.some(
      (rule) =>
        !plannerOperators[rule.operator] ||
        (rule.value && !["S", "N", "B"].includes(Object.keys(rule.value)[0])),
    )
  )
    throw new Error(
      "This planner supports scalar string, number and binary conditions. Enter a compatible access pattern.",
    );
  if (q.mode === "query") {
    const keys = keySchema(state.detail, q.index);
    if (
      keys.filter((k) => k.KeyType === "HASH").length !== 1 ||
      keys.filter((k) => k.KeyType === "RANGE").length > 1
    )
      throw new Error("Multi-attribute native keys need the advanced AWS API.");
    if (q.partition)
      conditions.unshift({
        attribute: keys.find((k) => k.KeyType === "HASH").AttributeName,
        operator: "=",
        value: q.partition,
      });
    if (q.sort)
      conditions.push({
        attribute: keys.find((k) => k.KeyType === "RANGE").AttributeName,
        operator: q.operator,
        value: q.sort,
        ...(q.sortEnd ? { end: q.sortEnd } : {}),
      });
  }
  if (!conditions.length)
    throw new Error(
      "The current scan has no key or filter conditions. Add the attributes you know for your lookup.",
    );
  fillPlanner({ ...q, conditions });
  document.getElementById("planner-form").dispatchEvent(new Event("input"));
}
function applyPlannerTemplate() {
  const value = document.getElementById("planner-template").value;
  const pk = state.detail.KeySchema.find(
    (k) => k.KeyType === "HASH",
  ).AttributeName;
  const sk =
    state.detail.KeySchema.find((k) => k.KeyType === "RANGE")?.AttributeName ||
    "sk";
  const templates = {
    custom: {
      conditions: [{ attribute: pk, operator: "=", value: { S: "" } }],
    },
    collection: {
      conditions: [
        { attribute: pk, operator: "=", value: { S: "CUSTOMER#123" } },
        {
          attribute: sk,
          operator: "begins_with",
          value: { S: "ORDER#2026-09" },
        },
      ],
    },
    sparse: {
      conditions: [
        {
          attribute: "openCustomerKey",
          operator: "=",
          value: { S: "CUSTOMER#123" },
        },
        {
          attribute: "createdAt",
          operator: "begins_with",
          value: { S: "2026-09" },
        },
      ],
      draftPartition: "openCustomerKey",
      draftSort: "createdAt",
    },
    inverted: {
      conditions: [
        { attribute: sk, operator: "=", value: { S: "PRODUCT#456" } },
        { attribute: pk, operator: "begins_with", value: { S: "CUSTOMER#" } },
      ],
      draftPartition: sk,
      draftSort: pk,
    },
  };
  fillPlanner(templates[value]);
  document.getElementById("planner-pattern-help").textContent = {
    custom:
      "Enter the literal attributes and values for your lookup. All conditions use AND.",
    collection:
      "Example string keys: a customer partition with an ORDER# prefix. Prefixes match from the left; adjust the names and values to your schema.",
    sparse:
      "Example: only open orders carry openCustomerKey and createdAt. Remove openCustomerKey when closed. Scope by customer to avoid one global OPEN partition; measure skew for large customers.",
    inverted:
      "Example: query relationships in reverse by exchanging key roles in a GSI. This requires those attributes and matching types on your relationship items.",
  }[value];
  document.getElementById("planner-form").dispatchEvent(new Event("input"));
}
async function compareQueryPlans(event) {
  event.preventDefault();
  const generation = state.generation,
    current = plannerState;
  const button = event.target.querySelector('[type="submit"]');
  const input = readPlanner();
  current.input = input;
  current.result = null;
  document.getElementById("planner-results").innerHTML =
    '<p class="info-note">Comparing table and index metadata…</p>';
  document.getElementById("planner-error").textContent = "";
  button.disabled = true;
  try {
    const result = await send(
      tablePath(current.table) + "/query-plan",
      "POST",
      input,
    );
    if (
      state.generation !== generation ||
      state.detailTab !== "planner" ||
      plannerState !== current ||
      JSON.stringify(readPlanner()) !== JSON.stringify(input)
    )
      return;
    current.result = result;
    const list = (values) =>
      values.length
        ? `<ul class="planner-notes">${values.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>`
        : "";
    document.getElementById("planner-results").innerHTML =
      `<section class="panel mt"><div class="panel-heading"><div><h2>${result.suggested ? "Compare query plans" : "No supported query covers this pattern"}</h2><p>${esc(result.basis)}</p></div><button class="button small" id="planner-export">${icon("download")}Export plan</button></div><div class="panel-body planner-candidates">${result.candidates.map((c, i) => `<article class="planner-candidate ${c.id === result.suggested ? "planner-suggested" : ""}"><div class="planner-candidate-title"><h3>${esc(c.name)}</h3><span class="tag ${c.blockers.length ? "red" : "green"}">${c.blockers.length ? "Needs changes" : c.id === result.suggested ? "Fewest filters" : "Query available"}</span><span class="tag">${esc(c.kind)}</span></div><p class="info-note">${c.keys.map((k) => `${esc(k.KeyType === "HASH" ? "Partition" : "Sort")}: <code>${esc(k.AttributeName)}</code>`).join(" · ")} · Projection ${esc(c.projection || "—")}</p><p><strong>Key conditions:</strong> ${esc(c.keyConditions.join(", ") || "None")}<br><strong>Post-read filters:</strong> ${esc(c.filterAttributes.join(", ") || "None")}</p>${list(c.blockers)}${list(c.warnings)}${c.request ? `<button class="button primary small" data-plan-use="${i}">Use in Items · review first</button><details class="type-guide"><summary>AWS Query request</summary><pre class="code-block" tabindex="0">${highlightJSON(JSON.stringify(c.awsRequest, null, 2))}</pre></details>` : ""}</article>`).join("")}${result.proposal ? `<article class="planner-candidate"><h3>Proposed GSI design</h3>${list(result.proposal.blockers)}${result.proposal.definition ? `${result.proposal.reuse.length ? `<p class="info-note">Existing indexes already use these keys: ${esc(result.proposal.reuse.join(", "))}. Review reusing them before adding another.</p>` : ""}<pre class="code-block" tabindex="0">${highlightJSON(JSON.stringify(result.proposal.definition, null, 2))}</pre>${list(result.proposal.notes)}` : ""}</article>` : ""}${list(result.notes)}</div></section>`;
    document
      .querySelectorAll("[data-plan-use]")
      .forEach(
        (el) => (el.onclick = () => useQueryPlan(Number(el.dataset.planUse))),
      );
    document.getElementById("planner-export").onclick = () =>
      saveDownload(
        JSON.stringify(
          {
            format: "dynamodb-tools-query-plan",
            version: 1,
            table: current.table,
            connection: workspaceNavigation.scope(state.overview.connection),
            pattern: input,
            ...result,
          },
          null,
          2,
        ),
        current.table + "-query-plan.json",
      ).catch((error) => toast(error.message, true));
  } catch (error) {
    if (state.generation === generation && state.detailTab === "planner") {
      document.getElementById("planner-error").textContent = error.message;
      document.getElementById("planner-results").innerHTML = "";
    }
  } finally {
    button.disabled = false;
  }
}
function useQueryPlan(index) {
  const plan = plannerState?.result?.candidates[index];
  if (!plan?.request || plannerState.table !== state.table) return;
  state.generation++;
  itemRequest++;
  state.busy = false;
  history.replaceState(null, "", tableHash(state.table));
  state.search = structuredClone(plan.request);
  state.savedQueryId = "";
  state.items = [];
  state.page = 1;
  state.cursors = [null];
  state.nextCursor = null;
  state.detailTab = "items";
  document.querySelectorAll(".tab").forEach((el) => {
    const active = el.dataset.tab === "items";
    el.classList.toggle("active", active);
    el.setAttribute("aria-selected", String(active));
    el.tabIndex = active ? 0 : -1;
  });
  document
    .getElementById("detail-content")
    .setAttribute("aria-labelledby", "tab-items");
  renderExplorer();
  document.getElementById("page-label").textContent = "Not run yet";
  document.getElementById("items-container").innerHTML = empty(
    "Query plan ready",
    "Review the conditions, then run or save the query.",
    "",
    true,
  );
  renderWorkspaceNavigation();
  document.getElementById("query-mode").focus();
}

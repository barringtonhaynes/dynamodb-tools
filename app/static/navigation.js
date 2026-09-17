function renderWorkspaceNavigation() {
  const nav = document.getElementById("workspace-navigation");
  if (!nav) return;
  const expanded = new Set(
    [...nav.querySelectorAll('[data-expand][aria-expanded="true"]')].map(
      (el) => el.closest("[data-node]").dataset.node,
    ),
  );
  const focused = document.activeElement.closest?.("[data-node]")?.dataset.node;
  const roots = workspaceNavigation.roots(
    state.overview,
    workspaceStorage.entries(),
  );
  function render(node) {
    const active = node.route === location.hash.slice(1);
    const icons = {
      dashboard: "overview",
      "star-full": "bookmark",
      "cloud-upload": "upload",
      history: "activity",
      "settings-gear": "settings",
      pulse: "activity",
      "symbol-structure": "layers",
      plug: "database",
      tools: "settings",
      warning: "alert",
    };
    const label = `<span class="explorer-label">${icon(icons[node.icon] || node.icon)}<span>${esc(node.label)}</span></span>`;
    const anchor = node.route
      ? `<a href="#${esc(node.route)}" ${active ? 'aria-current="page"' : ""} title="${esc(node.label)}">${label}</a>`
      : label;
    if (node.children) {
      const open = expanded.has(node.id);
      const id = "explorer-" + encodeURIComponent(node.id);
      const toggle = `<button type="button" class="explorer-toggle ${node.route ? "" : "explorer-group"}" data-expand aria-label="${open ? "Collapse" : "Expand"} ${esc(node.label)}" data-label="${esc(node.label)}" aria-expanded="${open}" aria-controls="${esc(id)}">${icon("chevron")}${node.route ? "" : label}</button>`;
      return `<div class="explorer-branch" data-node="${esc(node.id)}"><div class="explorer-row">${toggle}${node.route ? anchor : ""}</div><div class="explorer-children" id="${esc(id)}" ${open ? "" : "hidden"}>${node.children.length ? node.children.map(render).join("") : '<p class="explorer-empty">Nothing saved yet</p>'}</div></div>`;
    }
    return `<div class="explorer-leaf" data-node="${esc(node.id)}">${anchor}</div>`;
  }
  const scrollTop = nav.scrollTop;
  nav.innerHTML = roots.map(render).join("");
  nav.scrollTop = scrollTop;
  nav.onclick = (event) => {
    const button = event.target.closest("[data-expand]");
    if (!button) return;
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute(
      "aria-label",
      (open ? "Collapse " : "Expand ") + button.dataset.label,
    );
    document.getElementById(button.getAttribute("aria-controls")).hidden =
      !open;
  };
  if (focused)
    [...nav.querySelectorAll("[data-node]")]
      .find((el) => el.dataset.node === focused)
      ?.querySelector("a,button")
      ?.focus();
}
async function toggleFavourite() {
  const connection = state.overview?.connection;
  if (!connection || !state.table) return;
  const key = workspaceNavigation.favouriteKey(connection);
  const names = workspaceNavigation.favourites(
    connection,
    workspaceStorage.entries(),
  );
  const index = names.indexOf(state.table);
  if (index < 0) names.push(state.table);
  else names.splice(index, 1);
  await workspaceStorage.setItem(key, JSON.stringify(names));
  updateFavouriteButton();
  toast(
    index < 0
      ? "Table added to favourites on this computer."
      : "Table removed from favourites.",
  );
}
function updateFavouriteButton() {
  const button = document.getElementById("favourite-table");
  if (!button || !state.overview?.connection) return;
  try {
    const saved = workspaceNavigation
      .favourites(state.overview.connection, workspaceStorage.entries())
      .includes(state.table);
    button.textContent = saved ? "★ Favourited" : "☆ Favourite";
    button.setAttribute("aria-pressed", String(saved));
    button.onclick = () =>
      toggleFavourite().catch((error) => toast(error.message, true));
  } catch (error) {
    button.disabled = true;
    button.title = error.message;
  }
}
document.addEventListener("workspace-changed", () => {
  renderWorkspaceNavigation();
  updateFavouriteButton();
});
window.addEventListener("storage", () =>
  document.dispatchEvent(new Event("workspace-changed")),
);

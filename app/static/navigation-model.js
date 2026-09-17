/* Shared navigation definitions for the browser, desktop and native VS Code tree. */
const workspaceNavigation = (() => {
  const favouritePrefix = "dynamodb-tools.favourites.v1:";
  const queryPrefix = "dynamodb-tools.saved-queries.v1:";
  const scope = (connection) => [
    connection.mode === "aws" ? connection.account : connection.endpoint,
    connection.region,
  ];
  const favouriteKey = (connection) =>
    favouritePrefix + JSON.stringify(scope(connection));
  const queryKey = (connection, table) =>
    queryPrefix + JSON.stringify([...scope(connection), table]);
  const tableRoute = (table, options = {}) => {
    const params = new URLSearchParams(options).toString();
    return "tables/" + encodeURIComponent(table) + (params ? "?" + params : "");
  };
  function favourites(connection, entries) {
    const value = JSON.parse(entries[favouriteKey(connection)] || "[]");
    if (
      !Array.isArray(value) ||
      value.length > 1000 ||
      value.some(
        (name) =>
          typeof name !== "string" || !/^[A-Za-z0-9_.-]{3,255}$/.test(name),
      )
    )
      throw new Error(
        "Invalid saved favourites. Restore a valid workspace export.",
      );
    return [...new Set(value)];
  }
  const link = (id, label, route, icon = "table", extra = {}) => ({
    id,
    label,
    route,
    icon,
    ...extra,
  });
  const group = (id, label, icon, children) => ({ id, label, icon, children });
  function tableNode(name, connection, entries, prefix = "table") {
    const route = tableRoute(name);
    const children = [
      link(route + "/items", "Items", route),
      link(
        route + "/planner",
        "Query planner",
        tableRoute(name, { view: "planner" }),
        "search",
      ),
      link(
        route + "/schema",
        "Schema & indexes",
        tableRoute(name, { view: "schema" }),
        "layers",
      ),
      link(
        route + "/streams",
        "Streams",
        tableRoute(name, { view: "streams" }),
        "pulse",
      ),
      link(
        route + "/model",
        "Data model",
        tableRoute(name, { view: "model" }),
        "symbol-structure",
      ),
      link(
        route + "/partiql",
        "PartiQL",
        tableRoute(name, { view: "partiql" }),
        "code",
      ),
      link(
        route + "/manage",
        "Manage table",
        tableRoute(name, { view: "manage" }),
        "settings-gear",
      ),
    ];
    try {
      const queries = JSON.parse(entries[queryKey(connection, name)] || "[]");
      if (!Array.isArray(queries)) throw new Error("Invalid saved queries");
      children.splice(
        1,
        0,
        group(
          route + "/queries",
          "Saved queries",
          "bookmark",
          queries
            .filter(
              (q) =>
                q && typeof q.id === "string" && typeof q.name === "string",
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((q) =>
              link(
                route + "/query/" + q.id,
                q.name,
                tableRoute(name, { query: q.id }),
                "bookmark",
              ),
            ),
        ),
      );
    } catch {
      children.splice(
        1,
        0,
        link(
          route + "/query-error",
          "Saved queries could not be read",
          route,
          "warning",
        ),
      );
    }
    return link(prefix + "/" + name, name, route, "table", {
      table: name,
      children: children.map((child) => ({
        ...child,
        id: prefix + "/" + child.id,
        children: child.children?.map((leaf) => ({
          ...leaf,
          id: prefix + "/" + leaf.id,
        })),
      })),
    });
  }
  function roots(overview, entries = {}) {
    const connection = overview?.connection;
    const tables = overview?.tables || [];
    let favouriteNodes = [];
    if (connection) {
      try {
        favouriteNodes = favourites(connection, entries).map((name) =>
          tableNode(name, connection, entries, "favourite"),
        );
      } catch (error) {
        favouriteNodes = [
          link(
            "favourites-error",
            error.message,
            "settings/workspace",
            "warning",
          ),
        ];
      }
    }
    return [
      link("overview", "Overview", "overview", "dashboard"),
      group("favourites", "Favourites", "star-full", favouriteNodes),
      group("tables", "Tables", "table", [
        link("all-tables", "All tables / open by name", "tables", "search"),
        ...tables.map((t) => tableNode(t.TableName, connection, entries)),
        ...(overview?.tableDiscoveryWarning
          ? [
              link(
                "discovery-warning",
                "Discovery restricted · open by name",
                "tables",
                "warning",
              ),
            ]
          : []),
      ]),
      link("imports", "Import data", "imports", "cloud-upload"),
      link("copies", "Copy data", "copies", "copy"),
      link("activity", "Activity", "activity", "history"),
      group("settings", "Settings", "settings-gear", [
        link(
          "connection",
          "Connection & access",
          "settings/connection",
          "plug",
        ),
        link("workspace", "Saved workspace", "settings/workspace", "bookmark"),
        link("startup", "Startup configuration", "settings/startup", "tools"),
      ]),
    ].map((node) =>
      ["tables", "settings"].includes(node.id)
        ? { ...node, route: node.id }
        : node,
    );
  }
  const validRoute = (route) =>
    typeof route === "string" &&
    route.length < 4096 &&
    /^(overview|imports|copies|activity|settings(?:\/(connection|workspace|startup))?|tables(?:\/[A-Za-z0-9_.%-]+(?:\?(?:view=(items|schema|streams|model|planner|partiql|manage)|query=[A-Za-z0-9%_.~!()*'-]+))?)?)$/.test(
      route,
    );
  return {
    roots,
    scope,
    favouriteKey,
    favourites,
    favouritePrefix,
    tableRoute,
    validRoute,
  };
})();
if (typeof module !== "undefined") module.exports = workspaceNavigation;

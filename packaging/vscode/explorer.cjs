"use strict";
const vscode = require("vscode");
const navigation = require("./static/navigation-model.js");
class WorkspaceExplorer {
  constructor(request, openRoute, syncDefinitions) {
    this.request = request;
    this.openRoute = openRoute;
    this.syncDefinitions = syncDefinitions;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.entries = {};
    this.definitions = {};
    this.generation = 0;
  }
  dispose() {
    this.changed.dispose();
  }
  reset(paused = false) {
    this.paused = paused;
    this.generation++;
    this.overview = undefined;
    this.error = undefined;
    this.loading = undefined;
    this.changed.fire();
  }
  async json(path, options = {}) {
    const response = await this.request({ path, method: "GET", ...options });
    const data = JSON.parse(response.body);
    if (response.status >= 400)
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Could not load workspace",
      );
    return data;
  }
  async readLocal() {
    const data = await this.json("/api/local");
    this.setDefinitions(data.definitions || {});
    this.syncDefinitions(this.definitions);
  }
  setDefinitions(definitions) {
    this.definitions = definitions;
    this.entries = Object.fromEntries(
      Object.entries(definitions).map(([key, record]) => [key, record.value]),
    );
    this.changed.fire();
  }
  async load() {
    if (this.paused) return;
    if (this.overview || this.error) return;
    if (this.loading) return this.loading;
    const generation = this.generation;
    this.loading = (async () => {
      try {
        const [overview, local] = await Promise.all([
          this.json("/api/overview"),
          this.json("/api/local"),
        ]);
        if (generation !== this.generation) return;
        this.overview = overview;
        this.setDefinitions(local.definitions || {});
      } catch (error) {
        if (generation === this.generation) this.error = error.message;
      } finally {
        if (generation === this.generation) this.loading = undefined;
      }
    })();
    return this.loading;
  }
  async accept(message, response) {
    if (response.status >= 400) return;
    if (message.path === "/api/overview") {
      this.paused = false;
      this.overview = JSON.parse(response.body);
      this.error = undefined;
      this.changed.fire();
    } else if (
      message.path === "/api/local" &&
      (!message.method || message.method === "GET")
    ) {
      this.setDefinitions(JSON.parse(response.body).definitions || {});
    } else if (
      message.path === "/api/local/definition" &&
      message.method === "PUT"
    ) {
      await this.readLocal();
    } else if (message.path === "/api/connection" && message.method === "PUT")
      this.reset();
  }
  getTreeItem(node) {
    const item = new vscode.TreeItem(
      node.label,
      node.children
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.id;
    item.iconPath = new vscode.ThemeIcon(node.icon || "table");
    item.tooltip = node.tooltip || node.label;
    if (node.route)
      item.command = {
        command: "dynamodbTools.navigate",
        title: node.label,
        arguments: [node.route, node.connectionId],
      };
    if (node.table) {
      let favourite = false;
      try {
        favourite = navigation
          .favourites(this.overview.connection, this.entries)
          .includes(node.table);
      } catch {}
      item.contextValue = favourite ? "favouriteTable" : "table";
      item.description = favourite ? "★" : undefined;
    }
    return item;
  }
  async getChildren(node) {
    if (node && ["tables", "favourites"].includes(node.id)) {
      if (this.paused)
        return [
          {
            id: node.id + "/stopped",
            label: "Console stopped · open to reconnect",
            route: "settings",
            icon: "debug-start",
          },
        ];
      await this.load();
      if (this.error)
        return [
          {
            id: node.id + "/error",
            label: "Connection unavailable · open settings",
            tooltip: this.error,
            route: "settings/connection",
            icon: "warning",
          },
        ];
      const root = navigation
        .roots(this.overview, this.entries)
        .find((root) => root.id === node.id);
      return this.scoped(
        root.children.length
          ? root.children
          : [
              {
                id: node.id + "/empty",
                label: "No favourites yet · star a table",
                icon: "star-empty",
              },
            ],
      );
    }
    return this.scoped(
      node
        ? node.children || []
        : navigation.roots(this.overview, this.entries),
    );
  }
  scoped(nodes, connectionId = this.overview?.connection?.id) {
    return nodes.map((node) => ({
      ...node,
      connectionId:
        node.connectionId ||
        (node.table || node.route?.startsWith("tables/")
          ? connectionId
          : undefined),
      children: node.children
        ? this.scoped(node.children, node.connectionId || connectionId)
        : undefined,
    }));
  }
  async toggleFavourite(node) {
    await this.load();
    if (
      !node?.table ||
      !this.overview ||
      node.connectionId !== this.overview.connection.id
    )
      throw new Error(
        "Connection changed. Refresh the explorer before changing favourites.",
      );
    // Fetch the revision before writing, preserving another window's updates.
    await this.readLocal();
    const key = navigation.favouriteKey(this.overview.connection);
    const names = navigation.favourites(this.overview.connection, this.entries);
    const index = names.indexOf(node.table);
    if (index < 0) names.push(node.table);
    else names.splice(index, 1);
    await this.json("/api/local/definition", {
      method: "PUT",
      body: JSON.stringify({
        key,
        value: JSON.stringify(names),
        revision: this.definitions[key]?.revision || 0,
      }),
    });
    await this.readLocal();
  }
}
module.exports = { WorkspaceExplorer };

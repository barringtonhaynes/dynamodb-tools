# VS Code sidebar — extension 0.2.2

Verified on macOS arm64, 2026-09-17, using the actual installed VSIX in an isolated
VS Code profile. Native Activity Bar icon and Workspace shortcuts were visually
inspected. The test clicked Open Console, Connection settings, Activity and Tables.

Six checks passed: sidebar activation without service startup; opening by a native
tree-row click; navigation in an existing console; reuse of one panel; protection
of an open unsaved item draft; and direct Tables navigation after stopping the
backend. The readiness handshake queues cold-start navigation until initialization
finishes. Existing extension open/stop/reopen/restart, API bridge, persisted schema,
table discovery and table accessibility checks also passed. Syntax/format and
pre-commit checks passed.

Run `TEST_VSCODE_SIDEBAR=1 node tests/packaging/run-vscode.cjs` with
`VSCODE_EXECUTABLE` and a disposable `TEST_DDB_ENDPOINT` containing a populated
table. `T1_EXTENSION_PATH` can select the installed extension. Local evidence:
`test-results/vscode-sidebar.json`, `vscode-sidebar.png` and `vscode-host.json`.

Artifact: `dist/dynamodb-tools-0.2.2-darwin-arm64.vsix`.
SHA-256: `9074f6e7d4ab06432a5e374919c0d8196adaf1f10d7e68063624a28d2c1b974b`.

The full console stays in the editor area; the sidebar is a native launcher and
navigation view. No real AWS writes, changes to the user's VS Code profile or
marketplace publication were performed. Other platforms were not interactively
retested for this UI-only update.

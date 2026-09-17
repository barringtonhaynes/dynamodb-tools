# VS Code theme integration — extension 0.2.1

Verified on macOS arm64, 2026-09-17. The installed VSIX uses the active VS Code
theme for surfaces, controls, status text, focus, scrollbars and JSON highlighting.
An extension-only stylesheet leaves the browser and desktop palette unchanged.
The bundled service remains version 0.2.0; no backend behavior changed.

The real VS Code extension host switched between Default Light Modern, Default
Dark Modern, Default High Contrast and Default High Contrast Light in an isolated
profile. All four passed checks for matching host foreground/background, editor
font family and size, matching text/paint-layer metrics, visible selection text,
focus colour and preservation of the same editor DOM, unsaved draft and selection.
The item editor and table screen had zero axe violations in all four themes.
Screenshots were visually inspected. The existing extension lifecycle, API bridge,
table discovery and persisted-schema checks also passed. Syntax/format and
pre-commit checks passed.

Run with `TEST_VSCODE_THEMES=1 node tests/packaging/run-vscode.cjs`, supplying
`VSCODE_EXECUTABLE` and a disposable `TEST_DDB_ENDPOINT` with at least one table
containing an item. `T1_EXTENSION_PATH` selects an installed VSIX directory.
Reports are retained locally as `test-results/vscode-themes.json` and
`test-results/vscode-theme-*.png` / `vscode-table-*.png`.

Artifact: `dist/dynamodb-tools-0.2.1-darwin-arm64.vsix`.
SHA-256: `7ed4650c728eaad88831e37d32cde34c34156e4bd7222fc62fb00e914495e409`.

Custom themes inherit their supplied webview colours automatically; every custom
theme has not been contrast-tested. JSON uses the theme's debug-expression
colours, not custom TextMate token rules. No real AWS writes occurred, no user
editor settings were changed, and no marketplace release was published.

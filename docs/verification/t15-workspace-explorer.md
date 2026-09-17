# Workspace explorer — 0.3.0

Verified on macOS arm64 on 2026-09-17 against DynamoDB Local. Screenshots from the
installed VSIX and packaged desktop app were inspected.

- Installed VSIX: native expandable table/favourite/query/settings navigation,
  table and section selection, one editor with no duplicate sidebar, query
  preview with zero item-search requests, open-draft protection, cold startup,
  stop/reopen/restart, and favourite/query persistence all passed.
- Packaged desktop: expandable navigation, favourite/query persistence after app
  restart, workspace JSON validation including favourites, export/import,
  renderer isolation, service authentication and shutdown passed. Settings and
  expanded explorer accessibility checks reported zero WCAG A/AA violations.
- Browser: full desktop/mobile, keyboard, accessibility, CRUD, import/export,
  saved queries, filters, projection, Streams, TTL, PartiQL, model insights and
  bulk-operation regression passed. Tests created and cleaned up their own tables.
- Python: 156 tests passed. Host/navigation: 7 tests passed, including native
  service lifecycle and account/region isolation. Syntax/format checks passed.

Evidence (local generated reports): `test-results/vscode-sidebar.json`,
`vscode-sidebar.png`, `vscode-host.json`, `desktop-explorer.png`,
`axe-desktop.json`, `axe-vscode.json` and browser `axe-*.json` reports.

Artifacts:

| File | SHA-256 |
| --- | --- |
| `dist/dynamodb-tools-0.3.0-darwin-arm64.vsix` | `42cbd2915c1f10de96f3156c59b0b58d8ca789c0326b891ed2ee4364fb8ae03d` |
| `dist/desktop/dynamodb-tools-0.3.0-mac-arm64.dmg` | `b9332e2fb9e9aba4bf75cec935d140852ac6f563cec01d34557ddebe3b922ab4` |

Desktop signing is ad-hoc, without notarization. Other platforms were not
interactively retested. No real AWS writes or changes to the user's regular VS
Code profile were made. Saved data stays in each host's local workspace.sqlite3;
portable JSON export/import is explicit, with no automatic cloud sync.

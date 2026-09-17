# T1 installable preview verification

Captured 2026-09-17 for version 0.2.0, on macOS Apple Silicon.
This records a local preview, not a published or notarized release.
See [installation instructions](../installation.md) and
[the design](../designs/0002-installable-distributions.md).

## Results

- Python suite: 155 passed, zero failures or skips. This includes installed
  storage validation, future/corrupt database handling, optimistic revisions,
  private service authentication and existing AWS read-only protections.
- Native frozen-service suite: five passed. Covers launch, private handshake,
  authentication, settings/definition persistence, shutdown, restart, missing
  binary errors, startup cancellation/timeout and parent crash cleanup. Repeated
  against the executable extracted by VS Code's VSIX installer: five passed.
- Browser regression: passed, including read/query/edit, filters, saved queries,
  imports, exports, pagination, Streams, TTL, PartiQL and local destructive flows.
- Desktop: final DMG mounted read-only and app copied to a separate installation
  directory. Launched with an isolated user-data folder and an empty PATH;
  exercised settings, table discovery, definition import/conflict preview/export,
  API reference, renderer isolation, unauthorized API rejection, persistence
  across restart and shutdown. Passed.
- VS Code: final VSIX installed through the editor CLI in an isolated profile.
  Actual installed extension exercised in the extension host and rendered
  webview: open, stop, reopen, restart, API bridge, schema persistence and table
  discovery. Passed.
- Accessibility: desktop and VS Code axe checks reported zero violations for
  the exercised screens. Screenshots were inspected; this is not an exhaustive
  accessibility certification.
- JavaScript syntax/format checks and all configured pre-commit hooks passed.
- Tessera architecture inspection: zero errors, warnings or informational findings.

Local reports are retained under `test-results/`: `t1-python.xml`, `t1-hosts.xml`,
`vscode-host.json`, `axe-desktop.json`, `axe-vscode.json`, `desktop-settings.png`
and `vscode-tables.png`. Reports and large binaries are generated artifacts and
are not checked into Git.

## Local artifacts

Paths are relative to the repository. SHA-256 identifies these exact local builds;
future native CI builds may have different archive hashes.

| Artifact | SHA-256 |
| --- | --- |
| `dist/desktop/dynamodb-tools-0.2.0-mac-arm64.dmg` | `ac0d1fda3c317c114d642bc1b9e437a20729d79fae16ad8fc698797b5bca3237` |
| `dist/desktop/dynamodb-tools-0.2.0-mac-arm64.zip` | `3c32d2afcc3d4042c9ea4123eb5bf1dd7d453ccd953e04fd0464d5fa3eb2433e` |
| `dist/dynamodb-tools-0.2.0-darwin-arm64.vsix` | `691b0558531b952a83c0089f2d350d3668b36949582063614134919aef212f5d` |

## Boundaries of this evidence

macOS arm64 is the locally verified target. Native jobs are supplied for Intel
macOS, Windows x64 and Linux x64; their results must be checked before claiming
support. The DMG test used an isolated installation/data directory and empty PATH
on the development Mac, not a fresh OS image. Persistence across replacement is
provided by storage outside installation folders; a migration from a previously
released installed version cannot be tested because this is the first preview.

AWS behavior was checked with fixtures and the existing guard tests; UI integration
used DynamoDB Local. Valid live credentials remain required for a real account
smoke test. No real AWS data was mutated. Signing with a developer identity,
notarization, marketplace publication, automatic updates and public releases
remain separate release work.

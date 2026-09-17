# Install DynamoDB Tools

Version 0.3.0 is a local preview with a bundled Python service. You do not need a
source checkout, Python, Node or Docker to connect to AWS. Credentials remain in
your normal AWS SDK providers (environment, shared configuration, profiles, SSO,
credential processes or workload roles). SSO sessions must already be signed in.

## Desktop

On Apple Silicon macOS, open `dynamodb-tools-0.3.0-mac-arm64.dmg`, drag **DynamoDB
Tools** into Applications, then launch it. A ZIP containing the same application
is also provided. Start in Settings: choose your AWS profile and region, or an
optional local DynamoDB endpoint, then **Test connection** and **Save & connect**.
AWS defaults to read-only. Enabling writes still requires the existing per-action
account/region/target confirmation and delay.

These preview builds use ad-hoc signing and are not notarized. macOS may require
its normal **Privacy & Security → Open Anyway** approval for a downloaded build.
Do not disable Gatekeeper globally. A public signed/notarized release is a separate
release operation. The build explicitly disables automatic signing-identity
selection and does not publish artifacts or run an automatic updater.

The service starts and stops with the app on an available loopback port. Reopening
restarts a stopped service. Use the Workspace menu to return to connection
settings. Closing the app stops its owned service; finish database operations
before quitting because already-applied writes cannot be rolled back.

## Visual Studio Code

Choose **Extensions → … → Install from VSIX…**, select
`dynamodb-tools-0.3.0-darwin-arm64.vsix`, then run **DynamoDB Tools: Open Console**
from the Command Palette. The extension includes its own service and manages it
without a terminal. **Restart Console** and **Stop Console** are also available.
The explorer keeps the service available when you close its editor. Use **Stop Console** to stop it, or close VS Code. Use a trusted local workspace.

In extension 0.3.0, you can also click the **DynamoDB Tools** database icon in the
Activity Bar. Its expandable sidebar is the main navigation: favourite tables, all tables, saved queries, table sections and settings. Selecting a table opens its details in the editor without a duplicate sidebar. Simply showing the sidebar does not start the service; expanding Tables or Favourites loads connection metadata. Use the refresh icon to refresh discovery. If listing is restricted, choose **All tables / open by name**.

Extension 0.2.1 follows your active VS Code colour theme and editor font settings,
including both high-contrast variants. Switching themes preserves unsaved drafts
and cursor selection. The standalone desktop remains version 0.3.0.

The extension is a desktop, local extension, including when using Remote SSH or
containers: it uses the credentials and endpoints on your local computer. Browser
VS Code / Codespaces web is not supported. No executable path or secret is read
from workspace configuration. The webview cannot access Node or the service token.

## Saved work and upgrades

Settings shows the exact path of `connection.json`. The sibling
`workspace.sqlite3` holds versioned favourite tables, saved queries and item schemas. Settings → Saved workspace shows its exact path. Favourite tables are scoped to connection and region; saved queries also belong to a specific table. Neither file
is inside the installation. Desktop uses Electron's per-user data directory;
VS Code uses this extension's global storage. The two installations have separate
workspaces. Connection files contain preferences only, not access keys or tokens.

To migrate from the browser or between hosts, use **Settings → Saved workspace →
Export workspace**, then **Import workspace** in the destination. Review the
number of new and existing definitions and confirm import. Existing keys are
kept. Exports contain favourite table names, query values and schemas, which may be sensitive; choose
where you store them. Browser data remains unchanged. Table items, AWS credentials
and connection preferences are not included in this transfer.

Close the app/console and replace the app or install a newer compatible VSIX to
upgrade. Saved data remains in place. A future unsupported storage version or a
corrupt file produces an error instead of being reset. To recover, first back up
the folder; use a compatible app version or restore your backup. Remove the app
or uninstall the extension to remove binaries. User data is retained; delete the
settings folder separately only when you intend to remove it.

## Platform and validation status

| Target                      | Status                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| macOS arm64 (Apple Silicon) | Native packaging CI passes; desktop and editor UI exercised locally        |
| macOS x64                   | Native service tests and DMG / ZIP / VSIX packaging pass in CI             |
| Windows x64                 | Native service tests and NSIS / VSIX packaging pass in CI                  |
| Linux x64                   | Native service tests and AppImage / DEB / VSIX packaging pass in CI        |

Interactive installation and UI are locally verified only on Apple Silicon.
Other platforms have native build and service-test evidence, not desktop/editor
UI verification or a broad OS-version compatibility claim. Live AWS integration
verification still requires valid credentials; local and fixture tests do not
establish it. See the [verification record](verification/t1-installable-preview.md).

## Build from source

Use Python 3.11 and Node 22 or newer. Install `requirements-build.txt`, run `npm ci`,
then `python scripts/build-runtime.py`. This produces the frozen service and stages
extension assets. Run `npm run package:desktop` for the current OS, or `npm run package:vscode` for a VSIX tagged for the native OS/CPU.
Do not package a Python runtime built for another CPU or OS. Run the native checks
before distributing. The packaging workflow uploads build artifacts only; it
never publishes a marketplace extension or GitHub release.

`npm run test:hosts` tests the host boundary. Set `TEST_SERVICE` to a bundled
executable to enable lifecycle/persistence integration checks. `TEST_DESKTOP`
selects the packaged desktop executable for `node tests/packaging/desktop.mjs`.
`node tests/packaging/run-vscode.cjs` exercises the extension and its webview.
Set `TEST_DDB_ENDPOINT` to a disposable DynamoDB Local instance for UI checks.
Retained reports and screenshots live under `test-results/`.

Saved queries appear beneath each table. Selecting one fills its saved controls for review; **Run query** performs the read. Star tables in their main view or use the native explorer context action. Desktop and browser have the same expandable navigation.

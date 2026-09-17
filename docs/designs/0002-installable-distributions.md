# T1: standalone desktop and VS Code distributions

## Decision and scope

Use Electron for a sandboxed desktop window and a VS Code webview for the editor.
Both own the same PyInstaller one-folder Python service and existing console.
The service binds an ephemeral IPv4 loopback port; no Python, Node, Docker or
source checkout is required at runtime. DynamoDB Local remains optional.

Build per target (macOS arm64/x64, Windows x64, Linux x64), never cross-compile
the Python bundle. macOS arm64 is verified locally; other targets must pass their
native CI jobs before being described as validated. Local macOS artifacts are
ad-hoc signed preview builds, without notarization. Public publication, signing identities and marketplace credentials
remain release operations; no credentials are embedded and no auto-update executes.
Updates replace the application/VSIX and preserve its separate user-data directory.

## Boundaries and lifecycle

The parent starts a bundled executable by absolute path with no shell. The child
reports readiness only after startup completes, using a bounded JSON handshake
on a private stdout pipe. A random session capability never appears in URLs or
logs. Every dynamic endpoint requires this token and an exact loopback Host.
Electron adds authorization only to its service's origin. The VS Code webview
uses a restricted message bridge: the extension validates relative API paths,
methods and size, then calls its own service. It cannot nominate a URL or command.
No AWS credential is given to either renderer. Existing AWS write confirmation
and read-only gates still apply after local authentication.

Closing the host ends stdin; the child shuts down. Startup timeout, crash,
restart, cancellation and app exit clean up owned processes. An OS-selected port
avoids conflicts. Desktop navigation, permissions and new windows are restricted;
webviews use local assets and a restrictive CSP. Extensions run locally, require
trusted workspaces and do not execute workspace-configured commands.

## Persistence and migration

Versioned SQLite stores only saved-query and item-schema keys under the host's
user-data directory, independent of port and installation location. Per-key
optimistic revisions prevent silent overwrites from stale windows. Connection
preferences remain atomic, non-secret JSON. Each host owns its settings; export
and import transfers definitions between browser, desktop and VS Code. Import
validates format/size, previews conflicts and merges without overwriting existing
keys. Legacy browser data stays intact. Uninstall removes binaries, not user data.
Future database versions fail explicitly instead of downgrading or resetting data.

## Validation

Exercise real frozen-service launch/readiness/authentication/shutdown/restart,
settings and definition persistence, corrupted/newer storage, hostile bridge
requests, parent exit, port conflicts and missing binaries. Run Python regressions,
JavaScript checks, packaged Electron UI and VS Code extension-host checks. Test
with a disposable emulator or fixtures, never mutate a real AWS account for QA.
Validate installer/VSIX contents and retain artifact hashes and test reports.

## References

- https://www.electronjs.org/docs/latest/tutorial/security
- https://code.visualstudio.com/api/extension-guides/webview
- https://pyinstaller.org/en/stable/usage.html

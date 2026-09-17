# ADR 0004: bundle the shared service in two local hosts

Status: accepted for T1, 2026-09-17.

DynamoDB Tools uses an Electron Desktop Host and a local VS Code Extension, each
owning the FastAPI Backend as a native PyInstaller service. The existing console
is shared. The desktop renderer is sandboxed, without Node integration. VS Code
uses a restricted message bridge rather than exposing a service token or allowing
webview requests to arbitrary hosts. All dynamic service endpoints require a
random process-local capability and the exact loopback Host. Existing AWS gates
remain authoritative after authentication.

Installed Workspace definitions use versioned SQLite with optimistic revisions;
connection preferences remain non-secret JSON. Ports and application locations
can change without losing saved work. Browser exports migrate definitions with
conflict previews and no replacement of existing keys. Uninstall preserves data.

Builds are native to each OS/CPU and check the bundled service architecture before
packaging. The locally verified preview target is macOS arm64; CI definitions
cover macOS x64, Windows x64 and Linux x64. Public signing/notarization, marketplace
publication and automatic updates are outside this local preview delivery.

See [design](../designs/0002-installable-distributions.md) and
[installation](../installation.md) for lifecycle, validation and limitations.

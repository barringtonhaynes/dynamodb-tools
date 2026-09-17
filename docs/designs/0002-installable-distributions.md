# Standalone and VS Code distributions: planning brief

This brief captures T1's confirmed scope. Implementation has not started.

Deliver a locally installable standalone app and a Visual Studio Code extension
using the existing console and shared backend. AWS use must not need a source
checkout, Python/Node setup or a manually started development server. Keep a
local emulator optional. Preserve existing credential providers, preferences,
saved queries, schemas and AWS write safeguards.

Before implementation, choose and document the packaging framework, backend
lifecycle and authenticated local connection, supported OS/architecture matrix
(including macOS), extension webview boundary, data migration, signing, updates
and uninstall behavior. Do not treat a framework or a full Visual Studio IDE
extension as already selected. Validate clean installs, upgrades, shutdown,
permission errors and credential expiry in each supported distribution.

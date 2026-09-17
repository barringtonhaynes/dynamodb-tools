# VS Code Activity Bar and sidebar

Contribute a native DynamoDB Tools Activity Bar container and Workspace tree.
Use a monochrome database icon and native themed tree rows for Open Console,
Tables, Connection settings and Activity. Keep the full console in the editor
area and reuse its existing panel/service. Merely opening the sidebar must not
start the backend or contact AWS.

Route shortcuts use a small allowlist shared by host and webview. Queue the first
route until the console initializes; then use its normal navigation. Do not
replace webview HTML for navigation or discard an open item dialog.

Verify the actual Activity Bar/sidebar, opening by clicking a row, cold and warm
route navigation, single-panel reuse and stop/reopen behavior in an isolated
VS Code profile. Build an updated VSIX and verify its included icon and bridge.

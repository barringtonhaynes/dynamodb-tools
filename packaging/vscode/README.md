# DynamoDB Tools for Visual Studio Code

Open the Command Palette and run **DynamoDB Tools: Open Console**. The extension
starts its included service automatically. Choose an AWS profile/region or a local
DynamoDB endpoint in Settings. AWS starts read-only and uses your existing SDK
credential providers. For SSO, authenticate using your usual AWS CLI workflow.

The desktop edition and this extension offer the same tables, queries, item
editors, Streams, schemas and deliberate AWS write confirmations. No Python, Node
or Docker installation is required for AWS use. DynamoDB Local is optional.

Saved queries and schemas persist across restarts and upgrades. Use **Settings →
Saved workspace** to export/import definitions from the browser or desktop app.
Uninstalling the extension preserves its user-data folder. Use **Restart Console**
to recover from a stopped service, or **Stop Console** to release its resources.
Closing the console stops its service. This extension runs on the local machine,
including when the editor is connected to a remote workspace; web/Codespaces
browser editions are not supported. A trusted workspace is required.

Install the VSIX matching your operating system and CPU using **Extensions →
Install from VSIX…**. See the repository's `docs/installation.md` for platform
validation status, preview signing limitations and installation instructions.

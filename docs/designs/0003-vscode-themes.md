# VS Code theme integration

Load an extension-only stylesheet after the shared console CSS. Map the console
palette and component colours to VS Code webview theme tokens, including input,
button, selection, focus, status and editor surfaces. Use the host UI and editor
font settings. The browser and desktop retain their existing appearance.

VS Code updates its webview CSS variables and theme classes automatically. Use
those variables directly, without reloading the page or replacing the webview,
so switching themes preserves drafts, navigation and the running connection.
Support light, dark, high-contrast dark and high-contrast light themes; retain
visible borders and keyboard focus in high contrast. Custom themes follow the
same host tokens. JSON highlighting uses themed semantic colours with readable
fallbacks; exact TextMate token-colour matching is outside this change.

Verify real editor theme switching in an isolated VS Code profile, checking
settings, table UI and JSON editor colours, font settings, preserved draft state,
keyboard focus, screenshots and axe contrast checks. Repackage the extension.

Reference: https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content

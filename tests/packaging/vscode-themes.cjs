const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.check = async ({ webview, browser, root }) => {
  const waitFor = async (expression) => {
    for (let i = 0; i < 80; i++) {
      if (await webview.evaluate(expression)) return;
      await pause(200);
    }
    throw new Error("Theme check timed out: " + expression);
  };
  await webview.evaluate('document.querySelector(".table-link").click()');
  await waitFor("!!document.querySelector('[data-action=\"edit-item\"]')");
  await webview.evaluate("itemDialog(0)");
  await waitFor('!!document.getElementById("item-editor")');
  const draft =
    '{\n  "unsaved theme draft": "Keep me",\n  "count": 42,\n  "enabled": true\n}';
  await webview.evaluate(`(() => {
    window.themeDraftElement = document.getElementById('item-editor');
    themeDraftElement.value = ${JSON.stringify(draft)};
    themeDraftElement.dispatchEvent(new Event('input', {bubbles: true}));
    themeDraftElement.focus();
    themeDraftElement.setSelectionRange(6, 12);
  })()`);
  const reports = [];
  for (const [id, theme, kind] of [
    [1, "Default Light Modern", "vscode-light"],
    [2, "Default Dark Modern", "vscode-dark"],
    [3, "Default High Contrast", "vscode-high-contrast"],
    [4, "Default High Contrast Light", "vscode-high-contrast-light"],
  ]) {
    await fs.writeFile(
      path.join(root, "theme-request.json"),
      JSON.stringify({ id, theme }),
    );
    await waitFor(
      `document.body.classList.contains(${JSON.stringify(kind)}) && getComputedStyle(document.getElementById('item-editor')).fontSize === '15px'`,
    );
    // Allow existing 150–200 ms control transitions to settle after token updates.
    await pause(300);
    const styles = await webview.evaluate(`(() => {
      const s = (el) => getComputedStyle(el);
      const body = s(document.body);
      const editor = document.getElementById('item-editor');
      const probe = document.createElement('span');
      document.body.append(probe);
      const token = (name) => { probe.style.color = 'var(--vscode-' + name + ')'; return s(probe).color; };
      const result = {
        background: body.backgroundColor,
        expectedBackground: token('editor-background'),
        foreground: body.color,
        expectedForeground: token('editor-foreground'),
        sameEditor: editor === window.themeDraftElement,
        draft: editor.value,
        selection: [editor.selectionStart, editor.selectionEnd],
        selectionInk: getComputedStyle(editor, '::selection').webkitTextFillColor,
        font: s(editor).fontFamily,
        fontSize: s(editor).fontSize,
        paintFont: s(document.querySelector('.syntax-paint')).fontFamily,
        paintSize: s(document.querySelector('.syntax-paint')).fontSize,
        focus: s(document.querySelector('.json-editor')).outlineColor,
        expectedFocus: token('focusBorder'),
        tokens: [...document.querySelectorAll('#item-editor-panel .syntax-paint span')].map(el => ({kind: el.className, color: s(el).color})),
      };
      probe.remove();
      return result;
    })()`);
    assert.equal(styles.background, styles.expectedBackground, theme);
    assert.equal(styles.foreground, styles.expectedForeground, theme);
    assert.equal(
      styles.sameEditor,
      true,
      "Theme changes must preserve the editor DOM",
    );
    assert.equal(styles.draft, draft, theme);
    assert.deepEqual(styles.selection, [6, 12], theme);
    assert.notEqual(
      styles.selectionInk,
      "rgba(0, 0, 0, 0)",
      "Selected text stays readable above the paint layer",
    );
    assert.equal(styles.font, styles.paintFont);
    assert.equal(styles.fontSize, styles.paintSize);
    assert.equal(styles.fontSize, "15px");
    assert.equal(styles.focus, styles.expectedFocus);
    const violations = await webview.evaluate(
      '(async () => (await axe.run(document, {runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))()',
    );
    reports.push({ theme, kind, styles, violations });
    await browser
      .contexts()[0]
      .pages()[0]
      .screenshot({ path: `test-results/vscode-theme-${kind}.png` });
    await fs.writeFile(
      "test-results/vscode-themes.json",
      JSON.stringify(reports, null, 2),
    );
    assert.deepEqual(violations, [], theme);
    await webview.evaluate('document.querySelector("dialog[open]").close()');
    const tableViolations = await webview.evaluate(
      '(async () => (await axe.run(document, {runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))()',
    );
    reports[reports.length - 1].tableViolations = tableViolations;
    await fs.writeFile(
      "test-results/vscode-themes.json",
      JSON.stringify(reports, null, 2),
    );
    await browser
      .contexts()[0]
      .pages()[0]
      .screenshot({ path: `test-results/vscode-table-${kind}.png` });
    assert.deepEqual(tableViolations, [], theme + " table");
    await webview.evaluate(
      'document.querySelector("dialog").showModal(); themeDraftElement.focus(); themeDraftElement.setSelectionRange(6,12)',
    );
  }
  // Keep the unsaved draft unsubmitted; closing the test host discards it.
  console.log(
    "PASS: four live VS Code themes, contrast, editor fonts, focus, selection and unsaved draft preservation.",
  );
};

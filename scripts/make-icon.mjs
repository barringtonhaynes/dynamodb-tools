import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  const svg = (await fs.readFile('app/static/favicon.svg', 'utf8')).replace('viewBox=', 'width="1024" height="1024" viewBox=');
  await page.setContent('<style>body{margin:0}</style>' + svg);
  await page.screenshot({ path: 'packaging/desktop/icon.png', omitBackground: true });
} finally { await browser.close(); }

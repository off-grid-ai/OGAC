// Visual smoke test: dev-login to the console, then screenshot each route full-page.
// Usage: node scripts/shoot.mjs [route ...]   (defaults to the full set). Output → /tmp/shots.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const OUT = process.env.OUT || '/tmp/shots';
const routes = process.argv.slice(2);
const ROUTES = routes.length
  ? routes
  : ['fleet', 'agents', 'observability', 'lineage', 'integrations', 'brain', 'regulatory', 'admin'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();

await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /Dev sign-in/i }).click();
await page.waitForURL('**/fleet', { timeout: 20000 });

for (const r of ROUTES) {
  try {
    await page.goto(`${BASE}/${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${r}.png`, fullPage: true });
    console.log('ok', r);
  } catch (e) {
    console.log('FAIL', r, e.message);
  }
}

await browser.close();

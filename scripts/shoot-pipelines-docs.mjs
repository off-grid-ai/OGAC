// Docs screenshot harness for the Pipelines × Gateways surfaces. Logs into the LIVE console
// (wide + light), discovers a real pipeline id and gateway id from the list pages, and shoots the
// list, detail Overview, every pipeline tab, and the gateway detail INTO the docs public shot dir
// so the doc pages can embed them. Honest: a surface that fails to load is reported, never faked.
//
// Usage: node scripts/shoot-pipelines-docs.mjs
// Env: BASE, USER_EMAIL, PASS, OUT (defaults to public/docs-shots)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'https://onprem-console.getoffgridai.co';
const OUT = process.env.OUT || join(__dirname, '..', 'public', 'docs-shots');
const USER = process.env.USER_EMAIL || 'mac@wednesday.is';
const PASS = process.env.PASS || 'OffGrid-2026';

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

async function shoot(name, route, { full = true } = {}) {
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
    console.log('shot', name, '->', route);
    return true;
  } catch (e) {
    console.log('FAIL', name, route, e.message);
    return false;
  }
}

// --- login ---
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 });
await page.evaluate(() => localStorage.setItem('theme', 'light'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

// --- discover a real pipeline id + gateway id from the list pages ---
await page.goto(`${BASE}/pipelines`, { waitUntil: 'networkidle', timeout: 25000 });
await page.waitForTimeout(800);
const pid = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href^="/pipelines/"]')]
    .map((el) => el.getAttribute('href'))
    .find((h) => h && h.split('/').length === 3 && !h.endsWith('/new'));
  return a ? a.split('/')[2] : null;
});
await page.goto(`${BASE}/gateways`, { waitUntil: 'networkidle', timeout: 25000 });
await page.waitForTimeout(800);
const gid = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href^="/gateways/"]')]
    .map((el) => el.getAttribute('href'))
    .find((h) => h && h.split('/').length === 3);
  return a ? a.split('/')[2] : null;
});
console.log('discovered pipeline id =', pid, '| gateway id =', gid);

// --- shots ---
await shoot('pipelines-list', '/pipelines');
await shoot('gateways-list', '/gateways');
if (gid) await shoot('gateway-detail', `/gateways/${gid}`);
if (pid) {
  await shoot('pipeline-overview', `/pipelines/${pid}`);
  for (const tab of ['routing', 'policy', 'guardrails', 'quality', 'drift', 'observability', 'audit', 'cost', 'api', 'versions']) {
    await shoot(`pipeline-${tab}`, `/pipelines/${pid}/${tab}`);
  }
}

await browser.close();
console.log('done ->', OUT);

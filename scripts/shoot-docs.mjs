// Docs/landing screenshot harness — logs into the LIVE console via the owned username/password form,
// forces LIGHT theme for a uniform gallery, and captures every surface + key detail/flow screens at
// high DPI. Output -> public/docs-shots/ (the convention the /docs pages already reference).
//
//   BASE=https://onprem-console.getoffgridai.co USER=mac@example.com PASS=changeme \
//   OUT=public/docs-shots node scripts/shoot-docs.mjs [only-slug ...]
//
// Modeled on desktop/scripts/screenshots-pro.mjs (clean framing, light mode) + the proven login flow.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'https://onprem-console.getoffgridai.co';
const OUT = process.env.OUT || 'public/docs-shots';
const USER = process.env.USER_EMAIL || process.env.USER || 'mac@example.com';
const PASS = process.env.PASS || 'changeme';
const REIMB = process.env.REIMB_APP || 'app_bdd24eab';
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// route -> filename. Detail/flow screens use a seeded id. Extend freely.
const TARGETS = [
  ['fleet', 'fleet'],
  ['gateway', 'gateway'],
  ['control', 'control'],
  ['data/connectors/con_corebank', 'connectors'],
  ['data', 'data'],
  ['brain', 'brain'],
  ['knowledge', 'knowledge'],
  ['studio', 'studio'],
  [`apps/${REIMB}`, 'app-lifecycle'],
  [`apps/${REIMB}/runs`, 'app-runs'],
  [`apps/${REIMB}/review`, 'app-review'],
  [`apps/${REIMB}/reports`, 'app-reports'],
  ['chat', 'chat'],
  ['evals', 'evals'],
  ['observability', 'observability'],
  ['policy', 'policy'],
  ['guardrails', 'guardrails'],
  ['secrets', 'secrets'],
  ['access', 'access'],
  ['audit', 'audit'],
  ['lineage', 'lineage'],
  ['regulatory', 'regulatory'],
  ['storage', 'storage'],
  ['integrations', 'integrations'],
  ['prompts', 'prompts'],
  ['finops', 'finops'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

console.log('login…');
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 });
await page.evaluate(() => localStorage.setItem('theme', 'light'));
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(1500);
console.log('logged in, capturing…');

for (const [route, name] of TARGETS) {
  if (only.length && !only.includes(name) && !only.includes(route)) continue;
  try {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
    await wait(2600);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('ok', name);
  } catch (e) {
    console.log('FAIL', name, e.message.split('\n')[0]);
  }
}
await browser.close();
console.log('done ->', OUT);

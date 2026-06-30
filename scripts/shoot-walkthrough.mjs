// Walkthrough capture: log in via Keycloak, screenshot every console feature.
// Usage: BASE=http://127.0.0.1 KC_USER=mac@wednesday.is KC_PASS=OffGrid-2026 \
//        OUT=/tmp/shots node scripts/shoot-walkthrough.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1';
const OUT = process.env.OUT || '/tmp/shots';
const KC_USER = process.env.KC_USER || 'mac@wednesday.is';
const KC_PASS = process.env.KC_PASS || 'OffGrid-2026';
mkdirSync(OUT, { recursive: true });

// route slug -> filename. Detail screens use a seeded id.
const TARGETS = [
  ['fleet', 'fleet'],
  ['fleet/dev_01', 'fleet-device'],
  ['gateway', 'gateway'],
  ['control', 'control'],
  ['data', 'data'],
  ['brain', 'brain'],
  ['agents', 'agents'],
  ['observability', 'observability'],
  ['analytics', 'analytics'],
  ['finops', 'finops'],
  ['reports', 'reports'],
  ['lineage', 'lineage'],
  ['regulatory', 'regulatory'],
  ['integrations', 'integrations'],
  ['admin', 'admin'],
  // deep agentic screens (seeded)
  ['agents/sop-synth', 'agent-detail'],
  ['agents/sop-synth/runs/run_d1', 'agent-trace'],
  ['observability/evals/ev_1', 'eval-detail'],
  ['brain/prompts/pr_02b767db', 'prompt-detail'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();

console.log('login via keycloak…');
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /Continue with Keycloak/i }).click();
// Keycloak login form
await page.waitForSelector('#username', { timeout: 20000 });
await page.fill('#username', KC_USER);
await page.fill('#password', KC_PASS);
await page.click('#kc-login, input[type=submit], button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/signin') && !u.href.includes(':8080'), { timeout: 25000 });
console.log('logged in, landed at', page.url());

for (const [route, name] of TARGETS) {
  try {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('ok', name);
  } catch (e) {
    console.log('FAIL', name, e.message);
  }
}

await browser.close();
console.log('done ->', OUT);

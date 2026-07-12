// Docs/landing screenshot harness — logs into the LIVE console via the owned username/password form,
// forces LIGHT theme for a uniform gallery, and captures every surface + key detail/flow screens at
// high DPI. Output -> public/docs-shots/ (the convention the /docs pages already reference).
//
//   BASE=https://onprem-console.getoffgridai.co USER=you@example.com PASS=your-password \
//   OUT=public/docs-shots node scripts/shoot-docs.mjs [only-slug ...]
//
// Modeled on desktop/scripts/screenshots-pro.mjs (clean framing, light mode) + the proven login flow.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'https://onprem-console.getoffgridai.co';
const OUT = process.env.OUT || 'public/docs-shots';
const USER = process.env.USER_EMAIL || process.env.USER || 'mac@getoffgridai.co';
const PASS = process.env.PASS || 'changeme';
// Seeded ids for detail/flow screens (bank tenant = the canonical demo). Override via env.
const REIMB = process.env.REIMB_APP || 'bhapp_fnol';
const PIPE = process.env.PIPE_ID || 'pl_seed_org_bharat_cross-sell-advisor';
const GW = process.env.GW_ID || 'gw_seed_org_bharat_onprem-cluster';
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// route -> filename. Routes are the current section-nested paths (post #177). Detail/flow screens use
// a seeded id. Filenames match what README.md + the /docs pages already reference. Extend freely.
const TARGETS = [
  ['overview', 'overview'],
  ['workspace/chat', 'chat'],
  ['workspace/knowledge', 'knowledge'],
  ['workspace/prompts', 'prompts'],
  ['storage', 'storage'],
  ['build/studio', 'studio'],
  ['build/agents', 'agents'],
  ['build/evals', 'evals'],
  ['build/pipelines', 'pipelines-list'],
  [`build/apps/${REIMB}`, 'app-lifecycle'],
  [`build/apps/${REIMB}/runs`, 'app-runs'],
  [`build/apps/${REIMB}/review`, 'app-review'],
  [`build/apps/${REIMB}/reports`, 'app-reports'],
  [`build/pipelines/${PIPE}`, 'pipeline-overview'],
  [`build/pipelines/${PIPE}/policy`, 'pipeline-policy'],
  [`build/pipelines/${PIPE}/api`, 'pipeline-api'],
  ['gateway/ai', 'gateway'],
  ['gateway/registry', 'gateways-list'],
  [`gateway/registry/${GW}`, 'gateway-detail'],
  ['gateway/services', 'services'],
  ['data', 'data'],
  ['data', 'connectors'],
  ['data/warehouse', 'warehouse'],
  ['data/lineage', 'lineage'],
  ['data/retrieval', 'retrieval'],
  ['data/integrations', 'integrations'],
  ['governance', 'control'],
  ['governance/access', 'access'],
  ['governance/policy', 'policy'],
  ['governance/guardrails', 'guardrails'],
  ['governance/secrets', 'secrets'],
  ['governance/provenance', 'provenance'],
  ['governance/regulatory', 'regulatory'],
  ['insights/analytics', 'observability'],
  ['insights/finops', 'finops'],
  ['insights/audit', 'audit'],
  ['insights/accounting', 'accounting'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
// Force next-themes to LIGHT before any page script runs (storageKey 'theme'), on EVERY navigation —
// the demo session otherwise renders dark, which would clash with the light /docs gallery.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('theme', 'light');
  } catch {}
});
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

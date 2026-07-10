// One-off re-shoot harness (#222): re-capture every README + /docs console screenshot from the
// NOW-REAL bank demo tenant, into their EXISTING public/docs-shots/ paths (filenames stable).
// Wide (1600px), LIGHT mode, full page, networkidle + settle. Discovers real app/pipeline/gateway ids.
// Skips Fleet / lineage / brain (coming-soon / removed). Diagrams are hand-drawn, not shot here.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'https://bharatunion-onprem-console.getoffgridai.co';
const OUT = process.env.OUT || join(__dirname, '..', 'public', 'docs-shots');
const USER = process.env.USER_EMAIL || 'demo-bank@getoffgridai.co';
const PASS = process.env.PASS || 'OffGridDemo2026!';
const only = process.argv.slice(2);

mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

async function goto(route) {
  const url = route.startsWith('http') ? route : `${BASE}${route.startsWith('/') ? '' : '/'}${route}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch {
    // networkidle can time out on pages with long-poll; fall back to domcontentloaded + settle
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  await wait(2600);
}

async function shoot(name, route) {
  if (only.length && !only.includes(name)) return;
  try {
    await goto(route);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log('OK  ', name, '->', page.url());
  } catch (e) {
    console.log('FAIL', name, route, e.message.split('\n')[0]);
  }
}

// --- login ---
console.log('login…', BASE);
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name=username]', USER).catch(async () => {
  await page.fill('input[name=email]', USER);
});
await page.fill('input[name=password]', PASS);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 });
await page.evaluate(() => localStorage.setItem('theme', 'light'));
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(1500);
console.log('logged in, at', page.url());

// --- discover real ids ---
// Real seeded ids on the bank demo (discovered from the live studio/registry/data pages).
// A richly-seeded reimbursement app is the closest analog to the original app-lifecycle shots.
const appId = process.env.APP_ID || 'bhapp_reimb';
const pipeId = process.env.PIPE_ID || 'pl_seed_org_bharat_cross-sell-advisor';
const gwId = process.env.GW_ID || 'gw_seed_org_bharat_anthropic';
const connectorId = process.env.CONNECTOR_ID || 'bhcon_corebank';
console.log('ids -> app:', appId, '| pipeline:', pipeId, '| gateway:', gwId, '| connector:', connectorId);

// --- static surfaces (name -> current route) ---
const TARGETS = [
  ['overview', '/overview'],
  ['studio', '/build/studio'],
  ['agents', '/build/agents'],
  ['evals', '/build/evals'],
  ['chat', '/workspace/chat'],
  ['knowledge', '/workspace/knowledge'],
  ['prompts', '/workspace/prompts'],
  ['storage', '/workspace/storage'],
  ['retrieval', '/data/retrieval'],
  ['data', '/data'],
  ['integrations', '/data/integrations'],
  ['control', '/governance'],
  ['policy', '/governance/policy'],
  ['guardrails', '/governance/guardrails'],
  ['secrets', '/governance/secrets'],
  ['access', '/governance/access'],
  ['regulatory', '/governance/regulatory'],
  ['provenance', '/governance/provenance'],
  ['audit', '/insights/audit'],
  ['observability', '/insights'],
  ['finops', '/insights/finops'],
  ['accounting', '/insights/accounting'],
  ['gateway', '/gateway/ai'],
  ['gateways-list', '/gateway/registry'],
];

for (const [name, route] of TARGETS) await shoot(name, route);

// --- id-dependent surfaces ---
await shoot('connectors', `/data/connectors/${connectorId}`);
if (gwId) await shoot('gateway-detail', `/gateway/registry/${gwId}`);
if (pipeId) {
  await shoot('pipelines-list', '/build/pipelines');
  await shoot('pipeline-overview', `/build/pipelines/${pipeId}`);
  await shoot('pipeline-policy', `/build/pipelines/${pipeId}/policy`);
  await shoot('pipeline-api', `/build/pipelines/${pipeId}/api`);
} else {
  await shoot('pipelines-list', '/build/pipelines');
}
if (appId) {
  await shoot('app-lifecycle', `/build/apps/${appId}`);
  await shoot('app-runs', `/build/apps/${appId}/runs`);
  await shoot('app-review', `/build/apps/${appId}/review`);
  await shoot('app-reports', `/build/apps/${appId}/reports`);
}

await browser.close();
console.log('done ->', OUT);

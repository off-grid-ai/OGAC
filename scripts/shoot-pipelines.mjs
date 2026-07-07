// Audit screenshot harness for the pipelines × gateways surfaces. Logs into the LIVE console and
// shoots the list, detail Overview, every pipeline tab, and the gateway detail — for visual audit.
// Usage: node scripts/shoot-pipelines.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'https://onprem-console.getoffgridai.co';
const OUT = process.env.OUT || '/private/tmp/claude-501/-Users-user-wednesday-off-grid-ai-console/323d0eb2-d030-4591-b755-1399e29a3fc6/scratchpad/shots';
const USER = process.env.USER_EMAIL || 'mac@example.com';
const PASS = process.env.PASS || 'changeme';
const PID = process.env.PID || 'pl_seed_default_loan-underwriting';

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 });
await page.evaluate(() => localStorage.setItem('theme', 'light'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const shots = [
  ['pipelines-list', '/pipelines'],
  ['pipeline-overview', `/pipelines/${PID}`],
  ['pipeline-policy', `/pipelines/${PID}/policy`],
  ['pipeline-guardrails', `/pipelines/${PID}/guardrails`],
  ['pipeline-quality', `/pipelines/${PID}/quality`],
  ['pipeline-drift', `/pipelines/${PID}/drift`],
  ['pipeline-api', `/pipelines/${PID}/api`],
  ['pipeline-cost', `/pipelines/${PID}/cost`],
  ['pipeline-audit', `/pipelines/${PID}/audit`],
  ['pipeline-observability', `/pipelines/${PID}/observability`],
  ['gateways-list', '/gateways'],
  ['gateway-detail', '/gateways/gw_seed_default_onprem-cluster'],
];

for (const [name, route] of shots) {
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log('shot', name);
  } catch (e) {
    console.log('FAIL', name, e.message);
  }
}
await browser.close();
console.log('done ->', OUT);

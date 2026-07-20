// Full-product SANITY + UX crawl (task #238).
//
// Logs into the LIVE (read-only demo) console, then BFS-crawls every in-app link starting from a
// seed set of top-level routes. For each unique page it: screenshots it, and records HEALTH signals
// (nav HTTP status, any 5xx on its /api/ calls, uncaught page errors, and a blank/error-boundary
// heuristic). Because it follows real <a href>s it naturally reaches list -> detail, tabs, and the
// links that seeded entities point to (e.g. a built app's generated/deployed link).
//
// READ-ONLY: the crawler never submits a form, never clicks a destructive/mutating control — it only
// navigates (goto + anchor hrefs). The demo tenants are read-only anyway.
//
//   BASE=https://onprem-console.getoffgridai.co USER_EMAIL=... PASS=... \
//   OUT=/tmp/sanity MAX=300 node scripts/sanity-crawl.mjs
//
// Output: OUT/shots/*.png + OUT/report.json + OUT/report.md
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { REQUIRED_STREAMING_VISUAL_STATES } from './lib/visual-harness-policy.mjs';

const BASE = (process.env.BASE || 'https://onprem-console.getoffgridai.co').replace(/\/$/, '');
const OUT = process.env.OUT || '/tmp/sanity';
const USER = process.env.USER_EMAIL || process.env.USER || 'mac@getoffgridai.co';
const PASS = process.env.PASS || 'changeme';
const MAX = Number(process.env.MAX || 300);
const THEME = process.env.THEME || 'light';
const VIEWPORT = process.env.MOBILE ? { width: 390, height: 844 } : { width: 1600, height: 1000 };
mkdirSync(`${OUT}/shots`, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Seed routes so the crawl covers surfaces not linked from the home shell. Section landing pages;
// the BFS then discovers their detail views + tabs by following in-app links.
const SEEDS = [
  '', 'chat', 'studio', 'agents', 'tools', 'evals', 'observability', 'knowledge',
  'data', 'data/connectors', 'data/domains', 'data/warehouse', 'data/quality', 'data/etl',
  'gateway', 'gateways', 'pipelines', 'control', 'policy', 'guardrails', 'prompts',
  'governance', 'governance/regulatory', 'governance/provenance', 'audit', 'lineage',
  'insights', 'insights/analytics', 'insights/platform', 'finops',
  'access', 'secrets', 'storage', 'integrations', 'fleet', 'provit', 'settings',
  ...REQUIRED_STREAMING_VISUAL_STATES.map(({ url }) => url.replace(/^\//, '')),
];

// A path is "the same place" ignoring its query string; normalize so we don't recrawl ?tab= as new
// pages BUT we DO capture each tab (tabs usually use ?tab= or a path segment). We keep the search
// string in the key so distinct tabs are distinct captures, but strip volatile params.
const norm = (u) => {
  try {
    const url = new URL(u, BASE);
    if (url.origin !== new URL(BASE).origin) return null; // external -> handled separately
    url.hash = '';
    ['ts', 'r', 'cache'].forEach((p) => url.searchParams.delete(p));
    return url.pathname + (url.search || '');
  } catch { return null; }
};
const slug = (p) => (p.replace(/^\//, '') || 'home').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 90);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// ---- login (two-step: the credentials form is revealed by the "Sign in" button) ----
console.log(`login as ${USER} @ ${BASE}…`);
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await wait(800);
// Reveal the username/password form if it isn't already present.
if (!(await page.$('input[name=username]'))) {
  await page.click('button:has-text("Sign in"), a:has-text("Sign in")').catch(() => {});
  await page.waitForSelector('input[name=username]', { timeout: 15000 });
}
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 }),
  page.click('button[type=submit]'),
]);
await page.evaluate((t) => localStorage.setItem('theme', t), THEME);
await wait(800);

const results = [];
const seen = new Set();
const queue = SEEDS.map((s) => `${BASE}/${s}`);
const external = []; // generated-app / off-console links to visit separately

while (queue.length && results.length < MAX) {
  const raw = queue.shift();
  const key = norm(raw);
  if (!key || seen.has(key)) continue;
  seen.add(key);

  const errs = [];
  const api5xx = [];
  const onErr = (e) => errs.push(String(e.message || e).slice(0, 160));
  const onResp = (r) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 500) api5xx.push(`${r.status()} ${u.replace(BASE, '')}`); };
  page.on('pageerror', onErr);
  page.on('response', onResp);

  let status = 0;
  try {
    const resp = await page.goto(`${BASE}${key}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = resp ? resp.status() : 0;
    await wait(1600);
  } catch (e) { errs.push('NAV: ' + String(e.message).slice(0, 120)); }

  // blank / error-boundary heuristic
  const health = await page.evaluate(() => {
    const txt = (document.body?.innerText || '').trim();
    const lc = txt.toLowerCase();
    return {
      textLen: txt.length,
      errorBoundary: /something went wrong|application error|unhandled|500|this page could not|failed to load/i.test(lc)
        && txt.length < 1200,
      title: document.title,
    };
  }).catch(() => ({ textLen: 0, errorBoundary: true, title: '' }));

  const file = `${slug(key)}.png`;
  await page.screenshot({ path: `${OUT}/shots/${file}`, fullPage: false }).catch(() => {});

  const pass = status && status < 400 && !health.errorBoundary && health.textLen > 40 && api5xx.length === 0;
  results.push({ path: key, status, textLen: health.textLen, errorBoundary: health.errorBoundary, api5xx, errs, file, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${status}  ${key}  (${results.length}/${seen.size})`);

  // discover in-app links + external generated links
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')).filter(Boolean)).catch(() => []);
  for (const h of hrefs) {
    if (/^(mailto:|tel:|#|javascript:)/.test(h)) continue;
    const n = norm(h);
    if (n) { if (!seen.has(n)) queue.push(`${BASE}${n}`); }
    else if (/^https?:\/\//.test(h) && !h.startsWith(BASE)) { if (!external.includes(h)) external.push(h.slice(0, 300)); }
  }

  page.off('pageerror', onErr);
  page.off('response', onResp);
}

// ---- follow a sample of external (generated-app / off-console) links ----
const extResults = [];
for (const url of external.slice(0, 12)) {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await wait(1500);
    const len = await page.evaluate(() => (document.body?.innerText || '').length).catch(() => 0);
    const file = `ext_${slug(url.replace(/^https?:\/\//, ''))}.png`;
    await page.screenshot({ path: `${OUT}/shots/${file}` }).catch(() => {});
    const st = resp ? resp.status() : 0;
    extResults.push({ url, status: st, textLen: len, file, pass: st > 0 && st < 400 && len > 40 });
    console.log(`EXT ${st} ${url}`);
  } catch (e) { extResults.push({ url, status: 0, err: String(e.message).slice(0, 120), pass: false }); }
}

await browser.close();

const fails = results.filter((r) => !r.pass);
const report = { base: BASE, theme: THEME, viewport: VIEWPORT, user: USER, total: results.length,
  passed: results.length - fails.length, failed: fails.length, external: extResults.length, results, extResults };
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

const md = [
  `# Sanity crawl — ${BASE}`,
  `theme=${THEME} viewport=${VIEWPORT.width}x${VIEWPORT.height} user=${USER}`,
  ``,
  `**${report.passed}/${report.total} pages passed health check** · ${extResults.length} external links followed`,
  ``,
  fails.length ? `## FAILURES (${fails.length})` : `## No failures`,
  ...fails.map((f) => `- \`${f.path}\` — status ${f.status}, textLen ${f.textLen}${f.errorBoundary ? ', ERROR-BOUNDARY' : ''}${f.api5xx.length ? ', api5xx: ' + f.api5xx.join('; ') : ''}${f.errs.length ? ', errs: ' + f.errs.join(' | ') : ''}`),
  ``,
  `## External / generated links`,
  ...extResults.map((e) => `- ${e.pass ? 'ok' : 'FAIL'} ${e.status || '-'} ${e.url}`),
].join('\n');
writeFileSync(`${OUT}/report.md`, md);
console.log(`\n=== ${report.passed}/${report.total} passed, ${fails.length} failed, ${extResults.length} external. Report: ${OUT}/report.md ===`);

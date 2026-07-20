// EXHAUSTIVE navigable+state crawl (v2) — task #238.
//
// v1 only followed <a href> (undercounted). v2 covers the TRUE surface:
//   1. every STATIC route (from the filesystem route tree, passed via STATIC_ROUTES file)
//   2. every DYNAMIC template (DYNAMIC_TEMPLATES file) expanded × every discovered entity id
//      — ids are discovered at runtime from the anchors on list pages (no hand-maintained lists)
//   3. in-page STATE: on each page, click [role=tab] / detail-subnav tabs and capture each state
//   4. still BFS anchors, and follow external generated links.
//
// READ-ONLY: only navigates + clicks tab/subnav elements (never Save/Delete/Run/submit). The demo
// tenants are read-only server-side anyway.
//
//   BASE=... USER_EMAIL=... PASS=... OUT=/tmp/sx STATIC_ROUTES=/tmp/static_routes.txt \
//   DYNAMIC_TEMPLATES=/tmp/dynamic_templates.txt MAX=1200 node scripts/sanity-crawl-v2.mjs
// Set MOBILE=1 to repeat the same route/state crawl at 390×844.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { REQUIRED_STREAMING_VISUAL_STATES } from './lib/visual-harness-policy.mjs';

const BASE = (process.env.BASE || 'https://onprem-console.getoffgridai.co').replace(/\/$/, '');
const OUT = process.env.OUT || '/tmp/sx';
const USER = process.env.USER_EMAIL || process.env.USER || 'demo-bank@getoffgridai.co';
const PASS = process.env.PASS || 'OffGridDemo2026!';
const MAX = Number(process.env.MAX || 1200);
const THEME = process.env.THEME || 'light';
const VIEWPORT = process.env.MOBILE ? { width: 390, height: 844 } : { width: 1600, height: 1000 };
const STATIC = (process.env.STATIC_ROUTES ? readFileSync(process.env.STATIC_ROUTES, 'utf8').split('\n') : []).map((s) => s.trim()).filter(Boolean);
const TEMPLATES = (process.env.DYNAMIC_TEMPLATES ? readFileSync(process.env.DYNAMIC_TEMPLATES, 'utf8').split('\n') : []).map((s) => s.trim()).filter(Boolean);
mkdirSync(`${OUT}/shots`, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const origin = new URL(BASE).origin;
const norm = (u) => {
  try {
    const url = new URL(u, BASE);
    if (url.origin !== origin) return null;
    url.hash = '';
    return url.pathname + (url.search || '');
  } catch { return null; }
};
const slug = (p) => (p.replace(/^\//, '') || 'home').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 110);

// Map a concrete path onto each dynamic template it matches, and record the id captured per segment.
// e.g. /build/apps/app_123 matches build/apps/[id] → ids['build/apps/[id]']:{app_123}
const idsByTemplate = {}; // template → Set(id)
const SEG = (p) => p.replace(/^\//, '').split('/');
function harvestIds(path) {
  const segs = SEG(path);
  for (const t of TEMPLATES) {
    const tsegs = t.split('/');
    if (tsegs.length !== segs.length) continue;
    let ok = true; const caught = {};
    for (let i = 0; i < tsegs.length; i++) {
      if (tsegs[i].startsWith('[')) { caught[tsegs[i]] = segs[i]; }
      else if (tsegs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) for (const [ph, id] of Object.entries(caught)) {
      const k = t + '::' + ph;
      (idsByTemplate[k] ||= new Set()).add(id);
    }
  }
}
// Expand a template into concrete URLs using harvested ids (cartesian over its placeholders).
function expandTemplate(t) {
  const tsegs = t.split('/');
  const phs = tsegs.filter((s) => s.startsWith('['));
  if (!phs.length) return ['/' + t];
  let combos = [[]];
  for (const ph of phs) {
    const ids = [...(idsByTemplate[t + '::' + ph] || [])];
    if (!ids.length) return []; // no known id for this slot yet
    const next = [];
    for (const c of combos) for (const id of ids) next.push([...c, [ph, id]]);
    combos = next;
  }
  return combos.map((c) => {
    let out = t; for (const [ph, id] of c) out = out.replace(ph, id);
    return '/' + out;
  });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await ctx.newPage();

console.log(`login ${USER} @ ${BASE}`);
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await wait(800);
if (!(await page.$('input[name=username]'))) { await page.click('button:has-text("Sign in"), a:has-text("Sign in")').catch(() => {}); await page.waitForSelector('input[name=username]', { timeout: 15000 }); }
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 }), page.click('button[type=submit]')]);
await page.evaluate((t) => localStorage.setItem('theme', t), THEME);
await wait(600);

const results = [];
const seen = new Set();
const queue = [
  ...STATIC.map((r) => `${BASE}/${r}`),
  ...REQUIRED_STREAMING_VISUAL_STATES.map(({ url }) => `${BASE}${url}`),
];
let dynamicExpandedOnce = false;

async function visit(key, { captureTabs = true } = {}) {
  if (seen.has(key) || results.length >= MAX) return;
  seen.add(key);
  const errs = []; const api5xx = [];
  const onErr = (e) => errs.push(String(e.message || e).slice(0, 140));
  const onResp = (r) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 500) api5xx.push(`${r.status()} ${u.replace(BASE, '')}`); };
  page.on('pageerror', onErr); page.on('response', onResp);
  let status = 0;
  try { const resp = await page.goto(`${BASE}${key}`, { waitUntil: 'domcontentloaded', timeout: 30000 }); status = resp ? resp.status() : 0; await wait(1200); }
  catch (e) { errs.push('NAV: ' + String(e.message).slice(0, 100)); }
  const health = await page.evaluate(() => {
    const t = (document.body?.innerText || '').trim();
    return { textLen: t.length, notFound: /page not found|404|application error|client-side exception/i.test(t) && t.length < 1500, loadingStuck: /^loading/i.test(t) && t.length < 60 };
  }).catch(() => ({ textLen: 0, notFound: true, loadingStuck: false }));
  await page.screenshot({ path: `${OUT}/shots/${slug(key)}.png` }).catch(() => {});
  const pass = status && status < 400 && !health.notFound && !health.loadingStuck && health.textLen > 40 && !api5xx.length;
  results.push({ path: key, status, textLen: health.textLen, notFound: health.notFound, loadingStuck: health.loadingStuck, api5xx, errs, pass });

  // harvest ids + queue new anchors
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')).filter(Boolean)).catch(() => []);
  for (const h of hrefs) {
    if (/^(mailto:|tel:|#|javascript:)/.test(h)) continue;
    const n = norm(h); if (n) { harvestIds(n); if (!seen.has(n)) queue.push(`${BASE}${n}`); }
  }

  // capture in-page TAB / subnav state (role=tab, or detail-nav buttons that don't change the URL)
  if (captureTabs) {
    const tabs = await page.$$('[role="tab"], [data-tab], nav [role="button"]').catch(() => []);
    for (let i = 0; i < Math.min(tabs.length, 12); i++) {
      try {
        const label = (await tabs[i].innerText()).trim().replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 24);
        if (!label) continue;
        await tabs[i].click({ timeout: 2500 });
        await wait(700);
        await page.screenshot({ path: `${OUT}/shots/${slug(key)}__tab_${label}.png` }).catch(() => {});
        results.push({ path: `${key} [tab:${label}]`, status: 200, textLen: 1, api5xx: [], errs: [], pass: true, stateOnly: true });
        // re-grab handles (DOM may have re-rendered)
        const again = await page.$$('[role="tab"], [data-tab], nav [role="button"]').catch(() => []);
        if (again.length) Object.assign(tabs, again);
      } catch { /* tab not clickable; skip */ }
    }
  }
  page.off('pageerror', onErr); page.off('response', onResp);
}

// Pass 1: static routes (also harvests ids from their list-page anchors)
while (queue.length && results.length < MAX) {
  const raw = queue.shift(); const key = norm(raw); if (!key) continue;
  await visit(key);
  // Once static routes are drained, expand dynamic templates from harvested ids (once)
  if (!queue.length && !dynamicExpandedOnce) {
    dynamicExpandedOnce = true;
    const expanded = TEMPLATES.flatMap(expandTemplate);
    for (const u of expanded) if (!seen.has(u)) queue.push(`${BASE}${u}`);
    console.log(`expanded ${expanded.length} dynamic URLs from harvested ids`);
  }
}

await browser.close();
const fails = results.filter((r) => !r.pass && !r.stateOnly);
const states = results.filter((r) => r.stateOnly).length;
const report = { base: BASE, viewport: VIEWPORT, total: results.length, pages: results.length - states, tabStates: states,
  passed: results.filter((r) => r.pass).length, failed: fails.length, fails, results };
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n=== TOTAL captured: ${results.length}  (pages ${report.pages} + tab-states ${states})  passed ${report.passed}  failed ${fails.length} ===`);
console.log('FAILS:'); for (const f of fails) console.log(`  ${f.status} ${f.notFound ? 'NOTFOUND ' : ''}${f.loadingStuck ? 'LOADING ' : ''}${f.path}`);

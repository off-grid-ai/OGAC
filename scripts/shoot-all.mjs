#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// shoot-all.mjs — capture EVERY navigable route (+ key state changes) and emit a
// manifest a vision pass can audit. Reusable: point it at any host, tenant, theme,
// or viewport and it crawls the whole console.
//
//   node scripts/shoot-all.mjs \
//     --base=https://bharatunion-onprem-console.getoffgridai.co \
//     --user=demo-bank@getoffgridai.co --pass=OffGridDemo2026! \
//     --theme=light --viewport=wide --out=.shots/bank-light
//
// Flags (all optional; sensible defaults):
//   --base=<url>        console origin (default: http://localhost:3000)
//   --user= --pass=     sign-in creds (skipped if --user omitted — public routes only)
//   --theme=light|dark  (default light) — sets the next-themes cookie + prefers-color-scheme
//   --viewport=wide|mobile|<w>x<h>   (default wide=1440x900; mobile=390x844)
//   --out=<dir>         output dir (default .shots/<host>-<theme>-<viewport>)
//   --only=<substr>     only routes containing this substring (repeatable, comma-sep)
//   --states=on|off     also capture state-changes (open first create dialog on lists) (default on)
//   --public=on|off     include public routes (/,/docs,/features,…) (default on)
//   --routes-root=<dir> app dir to discover routes from (default src/app)
//
// Output: <out>/*.png  +  <out>/manifest.json  (route,url,file,status,title,consoleErrors,ok,notes)
// The manifest is the contract for the vision audit: a reviewer reads each PNG and
// checks it against {route,title} — does it render, make sense, and work.
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = (arg('base', 'http://localhost:3000')).replace(/\/$/, '');
const USER = arg('user', '');
const PASS = arg('pass', '');
const THEME = arg('theme', 'light');
const VIEWPORT_RAW = arg('viewport', 'wide');
const STATES = arg('states', 'on') !== 'off';
const PUBLIC = arg('public', 'on') !== 'off';
const ROUTES_ROOT = arg('routes-root', 'src/app');
const ONLY = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const host = new URL(BASE).hostname.split('.')[0] || 'local';
const OUT = arg('out', `.shots/${host}-${THEME}-${VIEWPORT_RAW}`);

const VP = VIEWPORT_RAW === 'mobile' ? { width: 390, height: 844 }
  : VIEWPORT_RAW === 'wide' ? { width: 1440, height: 900 }
  : (() => { const [w, h] = VIEWPORT_RAW.split('x').map(Number); return { width: w || 1440, height: h || 900 }; })();

// ── Route discovery: walk the app dir for page.tsx, strip (route-group) + /page.tsx ──
function discoverRoutes(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'api') walk(p); }
      else if (e.name === 'page.tsx') {
        let r = '/' + relative(root, dir).split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/');
        r = r.replace(/\/+$/, '') || '/';
        out.push(r);
      }
    }
  };
  walk(root);
  return [...new Set(out)].sort();
}

const isDynamic = (r) => /\[[^\]]+\]/.test(r);
const slug = (r) => (r === '/' ? 'root' : r.replace(/^\//, '').replace(/[/[\]]/g, '_')).replace(/_+/g, '_');

// Resolve a dynamic template to a concrete URL by scraping the nearest list page for a real id,
// left-to-right for each [seg]. Returns null if any id can't be resolved (logged, skipped).
async function resolveConcrete(page, template) {
  const segs = template.split('/').filter(Boolean);
  const concrete = [];
  for (let i = 0; i < segs.length; i++) {
    if (!/^\[.*\]$/.test(segs[i])) { concrete.push(segs[i]); continue; }
    const prefix = '/' + concrete.join('/');
    try {
      await page.goto(BASE + prefix, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(500);
      const childRe = new RegExp('^' + prefix.replace(/[/]/g, '\\/') + '\\/([^/?#]+)');
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      let id = null;
      for (const h of hrefs) {
        if (!h) continue;
        const m = h.match(childRe);
        if (m && m[1] && !/^\[/.test(m[1]) && !['new', 'runs', 'reports'].includes(m[1])) { id = m[1]; break; }
      }
      if (!id) return null;
      concrete.push(id);
    } catch { return null; }
  }
  return '/' + concrete.join('/');
}

async function shoot(page, route, url, rec) {
  const errors = [];
  // Ignore harmless third-party noise: the Cloudflare web-analytics beacon trips a CSP
  // report on every page — it's not an app error, so it must not flip `ok` to false.
  const isNoise = (t) => /cloudflareinsights\.com|beacon\.min\.js/i.test(t);
  const onErr = (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text().slice(0, 200)); };
  page.on('console', onErr);
  let status = 0;
  try {
    const resp = await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 35000 });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(900);
  } catch (e) { errors.push('nav: ' + e.message.slice(0, 120)); }
  const title = await page.title().catch(() => '');
  const file = `${slug(route)}.png`;
  try { await page.screenshot({ path: join(OUT, file), fullPage: true }); } catch (e) { errors.push('shot: ' + e.message.slice(0, 80)); }
  page.off('console', onErr);
  const body = (await page.textContent('body').catch(() => '')) || '';
  const brokenState = /application error|unhandled|something went wrong|500|stack trace/i.test(body);
  rec.push({ route, url, file, status, title, consoleErrors: errors.slice(0, 5),
    ok: status > 0 && status < 400 && !brokenState && !errors.length, notes: brokenState ? 'broken-state text on page' : '' });
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  let routes = discoverRoutes(ROUTES_ROOT);
  // classify: console (under (console)) vs public — discovery already stripped groups, so
  // split by a known public allowlist.
  const PUBLIC_ROUTES = ['/', '/docs', '/features', '/fleet-control', '/handbook', '/journey', '/signin'];
  if (!PUBLIC) routes = routes.filter((r) => !PUBLIC_ROUTES.includes(r));
  if (ONLY.length) routes = routes.filter((r) => ONLY.some((o) => r.includes(o)));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true, viewport: VP, colorScheme: THEME === 'dark' ? 'dark' : 'light',
  });
  // next-themes reads a cookie/localStorage; set both for determinism.
  await ctx.addCookies([{ name: 'theme', value: THEME, url: BASE }]);
  const page = await ctx.newPage();

  if (USER) {
    await page.goto(BASE + '/signin', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input[type="password"]', { timeout: 20000 });
    await page.fill('input[name="username"], input[type="email"], input[type="text"]', USER);
    await page.fill('input[type="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.toString().includes('/signin'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const rec = [];
  const dynamic = [];
  for (const route of routes) {
    if (isDynamic(route)) { dynamic.push(route); continue; }
    process.stdout.write(`· ${route}\n`);
    await shoot(page, route, route, rec);
    // state-change: open the first create/new dialog on list-ish pages (bounded, best-effort).
    if (STATES && /(^\/build\/(tools|evals)|connectors|domains|teams|access|prompts|secrets|pipelines$|studio$)/.test(route)) {
      try {
        const btn = page.locator('button:has-text("New"), button:has-text("Create"), button:has-text("Add")').first();
        if (await btn.count()) {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(800);
          await page.screenshot({ path: join(OUT, `${slug(route)}__create.png`), fullPage: true });
          rec.push({ route: route + ' [create dialog]', url: route, file: `${slug(route)}__create.png`, status: 200, title: 'state:create', consoleErrors: [], ok: true, notes: 'state-change capture' });
          await page.keyboard.press('Escape').catch(() => {});
        }
      } catch { /* no create affordance — fine */ }
    }
  }

  // dynamic routes: resolve one real id each, capture.
  for (const route of dynamic) {
    const url = await resolveConcrete(page, route);
    if (!url) { rec.push({ route, url: null, file: null, status: 0, title: '', consoleErrors: [], ok: false, notes: 'could not resolve a real id (empty collection?)' }); process.stdout.write(`× ${route} (no id)\n`); continue; }
    process.stdout.write(`· ${route} → ${url}\n`);
    await shoot(page, route, url, rec);
  }

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
    base: BASE, theme: THEME, viewport: VP, capturedAt: new Date().toISOString(),
    total: rec.length, ok: rec.filter((r) => r.ok).length, failed: rec.filter((r) => !r.ok),
    shots: rec,
  }, null, 2));
  await browser.close();
  const bad = rec.filter((r) => !r.ok);
  console.log(`\n${rec.length} captured → ${OUT} · ok=${rec.filter((r) => r.ok).length} · needs-review=${bad.length}`);
  for (const b of bad) console.log(`  ⚠ ${b.route} [${b.status}] ${b.notes} ${b.consoleErrors[0] || ''}`);
})();

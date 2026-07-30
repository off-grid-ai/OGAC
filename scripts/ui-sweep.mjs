// ─── Route-derived visual sweep ─────────────────────────────────────────────────────────────────────
//
// Founder: "figure out all the different routes, child routes, grandchildren routes in the application, and
// actually take screenshots of those and validate whether they make sense."
//
// ROUTES ARE ENUMERATED FROM THE ROUTER, never typed from what a screen is called. That rule was written into
// docs/ROADMAP_REAL_AUDIT.md today after four invented URLs came back 404 and nearly became four fake defects —
// and again after guessing table names produced three more. A sweep that invents its own targets manufactures
// findings, which is worse than not sweeping.
//
// Dynamic segments ([id], [slug]) are filled from --params so a detail route is exercised with a REAL entity
// rather than skipped; an unfilled segment is reported as skipped, never silently dropped.
//
//   node scripts/ui-sweep.mjs --list                        # enumerate only
//   DEMO_USER=… DEMO_PASS=… node scripts/ui-sweep.mjs        # screenshot every route
import { readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APP = new URL('../src/app', import.meta.url).pathname;

/** Every page.tsx under src/app, as a URL path. Route groups `(x)` and private `_x` folders are not segments. */
export function enumerateRoutes(dir = APP, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith('_') || entry === 'api') continue;
      const seg = entry.startsWith('(') && entry.endsWith(')') ? '' : `/${entry}`;
      out.push(...enumerateRoutes(full, prefix + seg));
    } else if (entry === 'page.tsx' || entry === 'page.ts') {
      out.push(prefix || '/');
    }
  }
  return [...new Set(out)].sort();
}

const routes = enumerateRoutes();
const dynamic = routes.filter((r) => r.includes('['));
const staticRoutes = routes.filter((r) => !r.includes('['));

const moduleArg = (process.argv.find((a) => a.startsWith('--module=')) || '').split('=')[1];
const inModule = (r) => !moduleArg || r === `/${moduleArg}` || r.startsWith(`/${moduleArg}/`);

// --emit writes the two files scripts/sanity-crawl-v2.mjs expects, so its route list is never hand-maintained.
// That crawler already handles dynamic-id discovery, in-page tab state and the mobile pass — this only feeds it.
if (process.argv.includes('--emit')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/static_routes.txt', staticRoutes.filter(inModule).join('\n') + '\n');
  writeFileSync('/tmp/dynamic_templates.txt', dynamic.filter(inModule).join('\n') + '\n');
  console.log(`wrote /tmp/static_routes.txt (${staticRoutes.filter(inModule).length}) and /tmp/dynamic_templates.txt (${dynamic.filter(inModule).length})`);
  console.log('now: BASE=… USER_EMAIL=… PASS=… OUT=/tmp/sx STATIC_ROUTES=/tmp/static_routes.txt DYNAMIC_TEMPLATES=/tmp/dynamic_templates.txt node scripts/sanity-crawl-v2.mjs');
  process.exit(0);
}

if (process.argv.includes('--list')) {
  const sr = staticRoutes.filter(inModule), dr = dynamic.filter(inModule);
  console.log(`${moduleArg ? `module /${moduleArg}: ` : ''}${sr.length + dr.length} routes — ${sr.length} static, ${dr.length} dynamic\n`);
  for (const r of staticRoutes.filter(inModule)) console.log(`  ${r}`);
  console.log('\ndynamic (need --params to exercise):');
  for (const r of dynamic.filter(inModule)) console.log(`  ${r}`);
  process.exit(0);
}

const { chromium } = await import('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp/ui-sweep';
const params = JSON.parse(process.env.PARAMS || '{}'); // { id: 'app_x', slug: 'y', name: 'z' }
mkdirSync(OUT, { recursive: true });

const fill = (route) => route.replace(/\[(\.\.\.)?(\w+)\]/g, (_, __, k) => params[k] ?? `[${k}]`);
const targets = routes.map(fill);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/signin?callbackUrl=%2Foverview`, { waitUntil: 'networkidle', timeout: 25000 });
await page.fill('input[name=username]', process.env.DEMO_USER);
await page.fill('input[name=password]', process.env.DEMO_PASS);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForTimeout(4000);

const problems = [];
for (const route of targets) {
  if (route.includes('[')) { problems.push(`SKIPPED (no param): ${route}`); continue; }
  const name = route.replace(/^\//, '').replace(/\//g, '_') || 'root';
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(2200);
    const body = await page.locator('body').innerText().catch(() => '');
    const status = resp?.status() ?? 0;
    // Heuristics for "does this make sense", each one a defect actually seen today.
    const flags = [];
    if (status >= 400) flags.push(`http ${status}`);
    if (/Application error|client-side exception|Unhandled/i.test(body)) flags.push('runtime error');
    if (body.trim().length < 120) flags.push('near-empty page');
    if (/\[\{"|"columns":\[/.test(body)) flags.push('raw JSON on screen');
    if (/\bconnector-query\b|data-domain|mysql|langfuse|opensearch/i.test(body)) flags.push('engineering vocabulary');
    if (/No .* yet|0 attached|\(0\)/.test(body) && !/^\/(signin|overview)/.test(route)) flags.push('empty state');
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    console.log(`${flags.length ? '⚠' : '✓'} [${status}] ${route}${flags.length ? '  ← ' + flags.join(', ') : ''}`);
    if (flags.length) problems.push(`${route}: ${flags.join(', ')}`);
  } catch (e) {
    console.log(`✗ ${route} — ${String(e.message).slice(0, 60)}`);
    problems.push(`${route}: threw`);
  }
}
console.log(`\n${problems.length} routes need a look:`);
for (const p of problems) console.log(`  ${p}`);
await browser.close();

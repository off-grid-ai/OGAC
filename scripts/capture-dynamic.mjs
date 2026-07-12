#!/usr/bin/env node
// capture-dynamic.mjs — supplement to shoot-all.mjs. Resolves REAL ids for the dynamic [id] routes
// shoot-all couldn't (it scrapes the wrong list page for some), then screenshots each concrete URL
// into the same output dir so the vision set covers static + dynamic + the built-app artifact view.
//
//   node scripts/capture-dynamic.mjs --base=http://localhost:3000 \
//     --user=demo-bank@getoffgridai.co --pass=… --out=/tmp/vision/bank
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const USER = arg('user', ''); const PASS = arg('pass', ''); const OUT = arg('out', '/tmp/vision/dyn');
const slug = (r) => r.replace(/^\//, '').replace(/[/[\]?=&]/g, '_').replace(/_+/g, '_');

// (list page to scrape, regex capturing the first real detail id from an href on it)
const SOURCES = {
  app: { list: '/build/studio', re: /\/build\/apps\/([a-z0-9_-]+)(?:$|[/?#])/i, skip: ['runs', 'reports', 'new'] },
  artifact: { list: '/workspace/artifacts', re: /\/artifacts\/([a-z0-9_-]+)\/view/i, skip: [] },
  project: { list: '/workspace/projects', re: /\/workspace\/projects\/([a-z0-9_-]+)(?:$|[/?#])/i, skip: ['new'] },
  pipeline: { list: '/build/pipelines', re: /\/build\/pipelines\/([a-z0-9_-]+)(?:$|[/?#])/i, skip: ['new'] },
  eval: { list: '/insights/evals', re: /\/insights\/evals\/([a-z0-9_-]+)(?:$|[/?#])/i, skip: [] },
  fleet: { list: '/gateway/fleet', re: /\/gateway\/fleet\/([a-z0-9_-]+)(?:$|[/?#])/i, skip: [] },
  conversation: { list: '/workspace/chat', re: /\/workspace\/chat\/([a-z0-9_-]+)(?:$|[/?#])/i, skip: ['new'] },
  connector: { list: '/data/connectors', re: /\/data\/connectors\/([a-z0-9_-]+)(?:$|[/?#])/i, skip: [] },
  etl: { list: '/data/etl', re: /\/data\/etl\/([a-z0-9_-]+)(?:$|[/?#])/i, skip: [] },
};

async function firstId(page, src) {
  try {
    await page.goto(BASE + src.list, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(700);
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    for (const h of hrefs) {
      if (!h) continue;
      const m = h.match(src.re);
      if (m && m[1] && !src.skip.includes(m[1])) return m[1];
    }
  } catch { /* fall through */ }
  return null;
}

// Concrete URLs to capture, given the resolved ids.
function urlsFor(ids) {
  const u = [];
  if (ids.app) {
    for (const tab of ['', '/input', '/runs', '/review', '/reports', '/quality', '/controls', '/access', '/schedule'])
      u.push(`/build/apps/${ids.app}${tab}`);
  }
  if (ids.artifact) u.push(`/artifacts/${ids.artifact}/view`); // the built-app generated link
  if (ids.project) u.push(`/workspace/projects/${ids.project}`);
  if (ids.pipeline) u.push(`/build/pipelines/${ids.pipeline}`);
  if (ids.eval) u.push(`/insights/evals/${ids.eval}`);
  if (ids.fleet) u.push(`/gateway/fleet/${ids.fleet}`);
  if (ids.conversation) u.push(`/workspace/chat/${ids.conversation}`);
  if (ids.connector) u.push(`/data/connectors/${ids.connector}`);
  if (ids.etl) u.push(`/data/etl/${ids.etl}`);
  return u;
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  await ctx.addCookies([{ name: 'theme', value: 'light', url: BASE }]);
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
  const ids = {};
  for (const [k, src] of Object.entries(SOURCES)) { ids[k] = await firstId(page, src); process.stdout.write(`  id ${k} = ${ids[k] || '(none)'}\n`); }
  const rec = [];
  for (const u of urlsFor(ids)) {
    let status = 0; const errors = [];
    try { const r = await page.goto(BASE + u, { waitUntil: 'networkidle', timeout: 35000 }); status = r?.status() ?? 0; await page.waitForTimeout(800); }
    catch (e) { errors.push('nav: ' + e.message.slice(0, 120)); }
    const file = `dyn_${slug(u)}.png`;
    try { await page.screenshot({ path: join(OUT, file), fullPage: true }); } catch { /* */ }
    const body = (await page.textContent('body').catch(() => '')) || '';
    const broken = /application error|unhandled|something went wrong|stack trace/i.test(body);
    rec.push({ route: u, url: u, file, status, ok: status > 0 && status < 400 && !broken && !errors.length, notes: broken ? 'broken-state' : (errors[0] || '') });
    process.stdout.write(`· ${u} [${status}]\n`);
  }
  await browser.close();
  // merge into the existing manifest so the vision set is one contract
  const mf = join(OUT, 'manifest.json');
  let manifest = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : { shots: [] };
  manifest.shots = [...(manifest.shots || []).filter((s) => !s.file?.startsWith('dyn_')), ...rec];
  manifest.dynamicIds = ids;
  writeFileSync(mf, JSON.stringify(manifest, null, 2));
  console.log(`\n${rec.length} dynamic captured → ${OUT} · ok=${rec.filter((r) => r.ok).length}`);
  for (const b of rec.filter((r) => !r.ok)) console.log(`  ⚠ ${b.route} [${b.status}] ${b.notes}`);
})();

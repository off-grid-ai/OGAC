// ─── verify-all-screens — sweep EVERY console screen and report which are actually broken ───────────
//
// verify-live-authed.mjs screenshots a hand-picked ROUTES list and prints status + h1. That answers
// "did this page respond", which is not the same question as "does this page work". A 200 with a
// rendered error boundary, a blank shell with no content, or a client crash after hydration all pass a
// status check and all look broken to someone being given a demo.
//
// So this sweep logs in ONCE and, per route, records: the HTTP status, whether an error boundary or
// crash message rendered, how much text actually painted, and any uncaught page errors / failed
// requests. It then classifies each screen BROKEN | THIN | OK so the fixing can be prioritised instead
// of eyeballing 174 screenshots.
//
// Screenshots are written for every route (cheap, and the demo review wants them), but the verdict is
// computed from the DOM, not from a human squinting at a PNG.
//
//   ssh -f -N -L 3000:127.0.0.1:3000 offgrid-tunnel
//   DEMO_USER=demo-bank@getoffgridai.co DEMO_PASS=… ROUTES_FILE=/tmp/routes.txt OUT=/tmp/sweep \
//     node scripts/verify-all-screens.mjs
//
// Prints one TSV line per route and a summary; writes report.json for follow-up.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp/sweep';
const USER = process.env.DEMO_USER;
const PASS = process.env.DEMO_PASS;
const WAIT = Number(process.env.WAIT_MS || 1400);
const SHOTS = process.env.SHOTS !== '0';

if (!USER || !PASS) {
  console.error('DEMO_USER and DEMO_PASS are required');
  process.exit(1);
}

const routes = readFileSync(process.env.ROUTES_FILE, 'utf8')
  .split('\n')
  .map((r) => r.trim())
  .filter((r) => r.startsWith('/'));

mkdirSync(OUT, { recursive: true });

// Markers that mean the page rendered a FAILURE rather than a surface. Kept narrow on purpose: a
// broad /error/i would match legitimate copy like "Error rate" on a metrics card.
const FAIL_TEXT =
  /application error|unhandled runtime error|something went wrong|internal server error|this page could not be loaded|client-side exception/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// Collect per-navigation diagnostics that a status code cannot show.
let pageErrors = [];
let failedRequests = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (!u.startsWith(BASE)) return; // ignore third-party/analytics noise
  // Next.js RSC PREFETCHES (…?_rsc=…) are speculative: the router fires them for links in view and
  // the browser aborts the in-flight ones the moment you navigate away. They show up as
  // 'requestfailed' on every single page and mean nothing is wrong. Counting them flagged all 174
  // screens BROKEN on the first sweep — a detector that says everything is broken says nothing.
  if (/[?&]_rsc=/.test(u)) return;
  // Same trap, one level deeper: `requestfailed` fires for ABORTED requests too, and a page whose
  // client component polls (the runs monitor, the gateway node list) always has a fetch in flight when
  // the sweep navigates on. Those aborts flagged three working screens BROKEN. A 4xx/5xx never appears
  // here anyway — it arrives on `response` — so an abort carries no information about the page.
  const errorText = r.failure()?.errorText ?? '';
  if (/ERR_ABORTED|context or browser has been closed/i.test(errorText)) return;
  failedRequests.push(`${r.method()} ${u.replace(BASE, '')} (${errorText})`);
});
page.on('response', (r) => {
  if (r.url().startsWith(BASE) && r.status() >= 500) {
    failedRequests.push(`${r.status()} ${r.url().replace(BASE, '')}`);
  }
});

await page.goto(`${BASE}/signin?callbackUrl=%2Foverview`, { waitUntil: 'networkidle', timeout: 30000 });
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 }).catch(() => {});

const report = [];
console.log('verdict\tstatus\troute\tchars\th1');

for (const route of routes) {
  const name = route.replace(/^\//, '').replace(/\//g, '_') || 'root';
  pageErrors = [];
  failedRequests = [];
  let status = 0;
  let text = '';
  let h1 = '';
  let landed = route;
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(WAIT);
    landed = new URL(page.url()).pathname;
    text = await page.locator('body').innerText().catch(() => '');
    h1 = await page.locator('h1').first().innerText().catch(() => '');
    if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  } catch (e) {
    report.push({ route, verdict: 'BROKEN', reason: `navigation: ${String(e.message).slice(0, 90)}`, status });
    console.log(`BROKEN\t${status}\t${route}\t-\tnavigation failed`);
    continue;
  }

  const chars = text.replace(/\s+/g, ' ').trim().length;
  const failMatch = FAIL_TEXT.exec(text);
  const reasons = [];
  if (status >= 400) reasons.push(`http ${status}`);
  if (failMatch) reasons.push(`error text "${failMatch[0]}"`);
  if (pageErrors.length) reasons.push(`js: ${pageErrors[0]}`);
  if (failedRequests.length) reasons.push(`req: ${failedRequests.slice(0, 2).join(', ')}`);

  // A redirect to signin means the sweep lost its session — report it rather than calling the page OK.
  if (landed.startsWith('/signin')) reasons.push('bounced to signin (session lost)');

  let verdict = reasons.length ? 'BROKEN' : 'OK';
  // Rendered, no errors, but essentially nothing painted: a real surface for a demo needs content.
  if (verdict === 'OK' && chars < 220 && !h1) verdict = 'THIN';

  report.push({ route, verdict, status, chars, h1: h1.slice(0, 60), reason: reasons.join(' | ') || undefined, landed });
  console.log(`${verdict}\t${status}\t${route}\t${chars}\t${(h1 || '').slice(0, 42)}${reasons.length ? '\t' + reasons.join(' | ') : ''}`);
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const by = (v) => report.filter((r) => r.verdict === v);
console.log(`\n── ${report.length} screens: ${by('OK').length} OK · ${by('THIN').length} THIN · ${by('BROKEN').length} BROKEN`);
for (const r of by('BROKEN')) console.log(`BROKEN ${r.route} — ${r.reason}`);
for (const r of by('THIN')) console.log(`THIN   ${r.route} — ${r.chars} chars`);

await browser.close();

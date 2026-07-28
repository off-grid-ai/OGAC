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
// Settle window after domcontentloaded: long enough for client-fetched surfaces to paint (or crash)
// so that "nothing rendered" means the screen is empty, not that we photographed it mid-fetch.
const WAIT = Number(process.env.WAIT_MS || 3500);
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
let aborted = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (!u.startsWith(BASE)) return; // ignore third-party/analytics noise
  // Next.js RSC PREFETCHES (…?_rsc=…) are speculative: the router fires them for links in view and
  // the browser aborts the in-flight ones the moment you navigate away. They show up as
  // 'requestfailed' on every single page and mean nothing is wrong. Counting them flagged all 174
  // screens BROKEN on the first sweep — a detector that says everything is broken says nothing.
  if (/[?&]_rsc=/.test(u)) return;
  // net::ERR_ABORTED is the browser cancelling a request, not a request that failed. Every fetch the
  // PREVIOUS screen still had in flight is aborted by this screen's goto(), and the abort event lands
  // after the per-route counters were reset — so it gets blamed on the innocent next route. That is how
  // /build/evals came back BROKEN for "GET /api/v1/admin/runs" which belongs to /build/apps/runs.
  // Keep aborts as evidence only; a real failure (connection refused, DNS, ERR_FAILED) still condemns.
  const err = r.failure()?.errorText || '';
  if (err.includes('ERR_ABORTED')) {
    aborted.push(`${r.method()} ${u.replace(BASE, '')}`);
    return;
  }
  failedRequests.push(`${r.method()} ${u.replace(BASE, '')} (${err})`);
});
// 4xx responses are recorded as EVIDENCE but do not by themselves condemn a screen: several surfaces
// legitimately probe for an optional resource and render fine when it is absent. Only 5xx (the server
// actually failed) forces a BROKEN verdict.
let api4xx = [];
page.on('response', (r) => {
  const u = r.url();
  if (!u.startsWith(BASE) || /[?&]_rsc=/.test(u)) return;
  if (r.status() >= 500) failedRequests.push(`${r.status()} ${u.replace(BASE, '')}`);
  else if (r.status() >= 400) api4xx.push(`${r.status()} ${u.replace(BASE, '')}`);
});

await page.goto(`${BASE}/signin?callbackUrl=%2Foverview`, { waitUntil: 'networkidle', timeout: 30000 });
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 30000 }).catch(() => {});

const report = [];
console.log('verdict\tstatus\troute\tmainChars\th1');

for (const route of routes) {
  const name = route.replace(/^\//, '').replace(/\//g, '_') || 'root';
  pageErrors = [];
  failedRequests = [];
  aborted = [];
  api4xx = [];
  let status = 0;
  let text = '';
  let mainText = '';
  let h1 = '';
  let landed = route;
  try {
    // NOT 'networkidle'. The console's sidebar keeps firing RSC prefetches for the links it shows, so
    // the network never goes idle on a data-dense screen and goto() times out — which the sweep then
    // reported as "navigation failed". /build/studio/forge and /build/studio/new were flagged BROKEN
    // that way while both render perfectly. domcontentloaded + the WAIT settle window is the honest
    // signal: the document arrived, then we give the client render time to paint and crash if it will.
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(WAIT);
    landed = new URL(page.url()).pathname;
    text = await page.locator('body').innerText().catch(() => '');
    // The THIN verdict has to be measured on the CONTENT, not on the document. Every authenticated
    // console screen paints ~545 characters of chrome (demo banner + sidebar nav + header), so a screen
    // that rendered literally nothing still reports ~700 body chars and the old `chars < 220` rule could
    // never fire — /operations/health/metrics/alerts read 760 body chars for 215 chars of content.
    mainText = (await page.locator('main').first().innerText().catch(() => '')) || '';
    // ':visible' matters: the small-screen gate ("Open this on a bigger screen") is an h1 that is
    // display:none at 1440px, yet innerText on a hidden node still returns its text — so a plain
    // locator('h1') reports a heading the operator cannot see, and the THIN rule below (which trusts
    // "has an h1") would never fire on a page whose only real content failed to render.
    h1 = await page.locator('h1:visible').first().innerText().catch(() => '');
    if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  } catch (e) {
    report.push({ route, verdict: 'BROKEN', reason: `navigation: ${String(e.message).slice(0, 90)}`, status });
    console.log(`BROKEN\t${status}\t${route}\t-\tnavigation failed`);
    continue;
  }

  const chars = text.replace(/\s+/g, ' ').trim().length;
  const mainChars = mainText.replace(/\s+/g, ' ').trim().length;
  const failMatch = FAIL_TEXT.exec(text);
  const reasons = [];
  if (status >= 400) reasons.push(`http ${status}`);
  if (failMatch) reasons.push(`error text "${failMatch[0]}"`);
  if (pageErrors.length) reasons.push(`js: ${pageErrors[0]}`);
  if (failedRequests.length) reasons.push(`req: ${failedRequests.slice(0, 2).join(', ')}`);

  // A redirect to signin means the sweep lost its session — report it rather than calling the page OK.
  // /signin itself is exempt: landing on signin is that route working, not a lost session.
  if (landed.startsWith('/signin') && !route.startsWith('/signin')) {
    reasons.push('bounced to signin (session lost)');
  }

  let verdict = reasons.length ? 'BROKEN' : 'OK';
  // Rendered, no errors, but essentially nothing painted INSIDE <main>: a heading and a one-line blurb
  // and then nothing is not a surface anyone can be shown. 200 chars is about "title + subtitle only" —
  // the emptiest screen that still has real structure (an all-zero metrics panel) measures ~215.
  if (verdict === 'OK' && mainChars < 200) verdict = 'THIN';

  report.push({
    route,
    verdict,
    status,
    chars,
    mainChars,
    mainText: mainChars < 400 ? mainText.replace(/\s+/g, ' ').trim() : undefined,
    h1: h1.slice(0, 60),
    reason: reasons.join(' | ') || undefined,
    landed,
    api4xx: api4xx.length ? [...new Set(api4xx)].slice(0, 6) : undefined,
    aborted: aborted.length ? [...new Set(aborted)].slice(0, 6) : undefined,
  });
  console.log(`${verdict}\t${status}\t${route}\t${mainChars}\t${(h1 || '').slice(0, 42)}${reasons.length ? '\t' + reasons.join(' | ') : ''}`);
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const by = (v) => report.filter((r) => r.verdict === v);
console.log(`\n── ${report.length} screens: ${by('OK').length} OK · ${by('THIN').length} THIN · ${by('BROKEN').length} BROKEN`);
for (const r of by('BROKEN')) console.log(`BROKEN ${r.route} — ${r.reason}`);
for (const r of by('THIN')) console.log(`THIN   ${r.route} — ${r.mainChars} chars in <main>: ${r.mainText || ''}`);

await browser.close();

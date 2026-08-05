#!/usr/bin/env node
// audit-shoot.mjs — screenshot a list of console routes as a signed-in admin, for VISUAL review.
//
// A UX/UI/usability finding needs the image. Reading JSX tells you what was intended; the screenshot
// tells you what a person gets — and in this codebase the gap between those two is where the defects
// live. So: shoot the route, then OPEN the PNG and judge it.
//
//   node scripts/audit-shoot.mjs --out=/tmp/audit/governance \
//     --routes=/governance/posture,/governance/policies,/governance/evidence/retention
//
// SHOOT THE TENANT THE DEMO ACTUALLY USES. The org is resolved from the HOST — a
// `<slug>-onprem-console.*` hostname sets x-offgrid-tenant-slug in middleware, which binds the org.
// A loopback or bare-localhost base therefore has NO tenant and falls back to `default`, the scratch
// org with draft apps, stale cases and empty catalogue tables. An audit run that way reports "walls of
// zeros" that a demo viewer would never see. This mistake invalidated a whole pass:
//
//   node scripts/audit-shoot.mjs --demo=insurer --out=/tmp/audit/insurer --routes=/overview,/work
//   node scripts/audit-shoot.mjs --demo=bank    --out=/tmp/audit/bank    --routes=/overview,/work
//
//   node scripts/audit-shoot.mjs --out=/tmp/audit/data --routes-file=/tmp/data-routes.txt
//
// Options:
//   --base=      default http://127.0.0.1:3005 (the shared dev server, SSH-forwarded from the box)
//   --width=     default 1600  (desktop-first: this console is judged on WIDE viewports)
//   --wait=      default 3500  ms after networkidle, for client fetches to land
//   --email=     default dev@offgrid.local
//   --dark       also shoot a dark-theme copy as <slug>.dark.png
//
// WHY 1600px BY DEFAULT: the repo's single most repeated design defect is wasted horizontal space.
// A page that looks fine at 1280 can still be a narrow column with empty gutters at 1600, so that is
// the width the rule is written against.
//
// The dev server is SHARED between reviewers. First hit on a route triggers a Next compile, so an
// early timeout is usually cold-compile, not a broken page — it retries once before reporting.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

// The two accounts the conference demo is handed out on, each on its own tenant host. `--demo=` picks
// one and supplies the matching base URL, so a reviewer cannot accidentally shoot `default`.
const DEMO = {
  insurer: {
    base: 'https://suraksha-onprem-console.getoffgridai.co',
    email: 'demo-insurer@getoffgridai.co',
    password: 'OffGridDemo2026!',
  },
  bank: {
    base: 'https://bharatunion-onprem-console.getoffgridai.co',
    email: 'demo-bank@getoffgridai.co',
    password: 'OffGridDemo2026!',
  },
};
const demo = DEMO[arg('demo', '')] ?? null;
const BASE = arg('base', demo?.base ?? 'http://127.0.0.1:3005').replace(/\/$/, '');
const OUT = arg('out', '/tmp/audit/shots');
const WIDTH = Number(arg('width', '1600'));
const WAIT = Number(arg('wait', '3500'));
const EMAIL = arg('email', demo?.email ?? 'dev@offgrid.local');
const PASSWORD = arg('password', demo?.password ?? 'dev');
// The real accounts authenticate through the `password` (ROPC) provider, whose credential field is
// `username`, not `email`. The dev-credentials provider is `dev`. Getting this wrong yields a 302 and
// a null session, which looks like a wrong password rather than a wrong provider.
const PROVIDER = arg('provider', demo ? 'password' : 'dev');

// Ceiling for the grown-viewport capture (see the screenshot block below). Generous enough for any real
// console page, low enough that a runaway list can't ask for a screenshot that dies out of memory.
const MAX_SHOT_HEIGHT = Number(arg('max-height', '12000'));

const routesFile = arg('routes-file', '');
const routes = (routesFile ? readFileSync(routesFile, 'utf8').split('\n') : arg('routes', '/').split(','))
  .map((r) => r.trim())
  .filter((r) => r && !r.startsWith('#'));

const slug = (r) =>
  r.replace(/^\//, '').replace(/[/?=&\[\]]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'root';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 } });

// Dev-credentials sign-in through the CONTEXT request API. Two things are load-bearing:
//  • The landing page's CSP blocks a same-origin fetch from the document, so page.evaluate fails.
//  • maxRedirects:0 — the session cookie rides on the 302 and following it can drop it.
const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()).csrfToken;
const login = await ctx.request.post(`${BASE}/api/auth/callback/${PROVIDER}`, {
  form:
    PROVIDER === 'password'
      ? { csrfToken: csrf, username: EMAIL, password: PASSWORD, callbackUrl: '/' }
      : { csrfToken: csrf, email: EMAIL, password: PASSWORD, callbackUrl: '/' },
  maxRedirects: 0,
});
const session = await (await ctx.request.get(`${BASE}/api/auth/session`)).json();
if (!session?.user) {
  console.error(
    `SIGN-IN FAILED (${login.status()}). If cookies came back __Secure-/__Host- prefixed, the dev ` +
      `server was started without AUTH_URL=${BASE} — a browser refuses those over plain http.`,
  );
  process.exit(1);
}
console.log(
  `signed in as ${session.user.email} (role ${session.user.role ?? '?'}, org ${session.user.org ?? '?'}) at ${BASE}`,
);
// Loud, because auditing the wrong tenant is the single most expensive mistake available here: it
// produces empty screens that look like product defects and are not.
if (!demo && !arg('base', '')) {
  console.warn(
    'WARNING: no --demo and no --base — this is the DEFAULT scratch org, not a demo tenant. Empty\n' +
      '         screens seen here are probably absent seed data, not defects. Use --demo=insurer|bank.',
  );
}

const page = await ctx.newPage();
// Collect what the page itself complains about — a console error is a finding even when the pixels look fine.
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 120)}`);
});

const report = [];

for (const route of routes) {
  const name = slug(route);
  problems.length = 0;
  let landed = null;
  for (const attempt of [1, 2]) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: attempt === 1 ? 45000 : 90000 });
      landed = page.url();
      break;
    } catch (e) {
      if (attempt === 2) problems.push(`navigation failed: ${e.message.slice(0, 140)}`);
    }
  }
  await page.waitForTimeout(WAIT);

  // Geometry the layout rule is actually about: does the content fill the width, or is it a narrow
  // column with dead gutters? Measured rather than eyeballed, because "looks fine" is not the rule.
  const geo = await page
    .evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const kids = Array.from(main.querySelectorAll(':scope > *'));
      const widest = Math.max(0, ...kids.map((k) => k.getBoundingClientRect().width));
      return {
        vw: window.innerWidth,
        mainWidth: Math.round(main.getBoundingClientRect().width),
        contentWidth: Math.round(widest),
        bodyScrollWidth: document.body.scrollWidth,
        horizontallyScrolls: document.body.scrollWidth > window.innerWidth + 2,
        text: (document.body.innerText || '').slice(0, 400),
      };
    })
    .catch(() => null);

  // GROW THE VIEWPORT TO THE CONTENT BEFORE CAPTURING.
  //
  // `fullPage: true` is not enough here and quietly produced a one-viewport crop for every shot taken
  // on 2026-08-05 — so nine section audits judged only the top ~1000px of every tall page, and real
  // defects below the fold (an app's whole Quality panel, contradictory stat tiles) were never seen. It
  // was not a diligence failure; the evidence was cropped before anyone looked at it.
  //
  // The cause: this console's shell is `h-screen` with `overflow-hidden` at every level, so
  // document.body NEVER scrolls. Playwright's fullPage measures the document, finds one viewport, and
  // stops. The page's real scroll region is a NESTED DIV inside <main>.
  //
  // So: find the element that actually scrolls, then resize the viewport to its full scrollHeight and
  // let the layout reflow. That turns the inner scroller into no scroller at all, and fullPage then
  // genuinely captures everything.
  const grew = await page
    .evaluate(() => {
      const OVERHEAD = 8; // rounding + sub-pixel borders, so the last row is never shaved off
      let tallest = 0;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const style = getComputedStyle(el);
        if (!/(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)) continue;
        const extra = el.scrollHeight - el.clientHeight;
        if (extra > tallest) tallest = extra;
      }
      // Also honour a body that DOES scroll (the landing page), so this helps both shells.
      const bodyExtra = document.documentElement.scrollHeight - window.innerHeight;
      return Math.max(tallest, bodyExtra, 0) + (tallest > 0 || bodyExtra > 0 ? OVERHEAD : 0);
    })
    .catch(() => 0);
  if (grew > 0) {
    // Capped: a virtualised or infinite list could otherwise ask for a 200k-pixel screenshot that
    // exhausts memory and yields nothing. A capped shot is still far more than one viewport.
    const target = Math.min(1000 + grew, MAX_SHOT_HEIGHT);
    await page.setViewportSize({ width: WIDTH, height: target });
    await page.waitForTimeout(700); // let the reflow settle (sticky headers, charts re-measuring)
  }

  const shot = join(OUT, `${name}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  // Restore, so the next route is measured against the real desktop viewport rather than a tall one.
  if (grew > 0) {
    await page.setViewportSize({ width: WIDTH, height: 1000 });
    await page.waitForTimeout(200);
  }
  if (flag('dark')) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${name}.dark.png`), fullPage: true }).catch(() => {});
    await page.emulateMedia({ colorScheme: 'light' });
  }

  const redirected = landed && !landed.includes(route) ? landed.replace(BASE, '') : null;
  const gutter = geo ? geo.mainWidth - geo.contentWidth : null;
  report.push({
    route,
    file: `${name}.png`,
    redirectedTo: redirected,
    contentWidth: geo?.contentWidth ?? null,
    viewportWidth: geo?.vw ?? null,
    // Flagged, not judged: a wide dead gutter is the repo's most repeated design defect, but a single
    // reading column is legitimately narrow. Open the image before calling it.
    suspectNarrow: geo ? geo.contentWidth > 0 && geo.contentWidth < geo.vw * 0.6 : null,
    horizontallyScrolls: geo?.horizontallyScrolls ?? null,
    firstText: (geo?.text ?? '').split('\n').filter(Boolean).slice(0, 3).join(' | '),
    problems: [...new Set(problems)].slice(0, 8),
  });
  const marks = [
    redirected ? `→ ${redirected}` : '',
    report.at(-1).suspectNarrow ? 'SUSPECT-NARROW' : '',
    geo?.horizontallyScrolls ? 'H-SCROLL' : '',
    problems.length ? `${problems.length} console/HTTP problems` : '',
  ]
    .filter(Boolean)
    .join('  ');
  console.log(`${route.padEnd(46)} ${name}.png  ${marks}`);
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.length} shots + report.json in ${OUT}`);
console.log('NOW OPEN THE PNGs. report.json flags geometry and console errors; it cannot see whether the');
console.log('screen makes sense to the persona, which is the part that matters.');
await browser.close();

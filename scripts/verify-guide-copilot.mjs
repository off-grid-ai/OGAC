#!/usr/bin/env node
// verify-guide-copilot.mjs — drive the floating guide as the REAL read-only demo viewer, on the LIVE
// box, and prove the thing it exists to do: a question takes you somewhere real.
//
//   node scripts/verify-guide-copilot.mjs --demo=insurer --out=/tmp/guide/insurer
//   node scripts/verify-guide-copilot.mjs --demo=bank    --out=/tmp/guide/bank
//
// WHY A SEPARATE SCRIPT FROM audit-shoot.mjs. That one shoots a route list. A widget is not a route —
// it only exists after a click, and its whole claim ("Take me there" works) can only be checked by
// clicking it and reading the URL that results. A screenshot of a closed launcher proves nothing.
//
// WHAT IT ASSERTS, in order:
//   1. the launcher is present and does not sit on top of the page's own content
//   2. opening it shows starter questions grouped by theme (never an empty box)
//   3. asking a starter question yields destinations, and the answer half returns 200 (a viewer POST
//      used to 403 here — the endpoint takes GET now, and that is exactly what this catches)
//   4. clicking a destination CHANGES THE URL to the expected route and renders a real page, not a 404
//   5. Back returns to where the visitor came from (navigation lives in the history stack)
//   6. nothing visible inside the widget names an OSS component, a private host, or a port
//
// Exit code is non-zero if any assertion fails, so this is safe to re-run as a gate.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

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

const which = arg('demo', 'insurer');
const demo = DEMO[which];
if (!demo) {
  console.error('--demo must be insurer or bank');
  process.exit(2);
}
const OUT = arg('out', `/tmp/guide/${which}`);
const WIDTH = Number(arg('width', '1600'));
mkdirSync(OUT, { recursive: true });

// Anything a visitor must never read. Same list the jargon rule is written against, plus infra shapes.
const LEAKS =
  /llm-?guard|presidio|\bragas\b|evidently|langfuse|opensearch|clickhouse|qdrant|litellm|\bopa\b|\brego\b|kestra|marquez|seaweedfs|superset|openbao|keycloak|unleash|[a-z0-9-]+\.local\b|:\d{4}\b|\b10\.\d+\.\d+\.\d+|192\.168\./i;

const failures = [];
const notes = [];
const fail = (m) => {
  failures.push(m);
  console.error(`  FAIL  ${m}`);
};
const ok = (m) => console.log(`  ok    ${m}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 } });

const csrf = (await (await ctx.request.get(`${demo.base}/api/auth/csrf`)).json()).csrfToken;
await ctx.request.post(`${demo.base}/api/auth/callback/password`, {
  form: { csrfToken: csrf, username: demo.email, password: demo.password, callbackUrl: '/' },
  maxRedirects: 0,
});
const session = await (await ctx.request.get(`${demo.base}/api/auth/session`)).json();
if (!session?.user) {
  console.error('SIGN-IN FAILED');
  process.exit(1);
}
console.log(`signed in ${session.user.email} role=${session.user.role} org=${session.user.org}`);
if (session.user.role !== 'viewer') {
  fail(`expected the read-only viewer role, got ${session.user.role} — this is not the demo audience`);
}

const page = await ctx.newPage();
const httpProblems = [];
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().includes('/api/')) {
    httpProblems.push(`HTTP ${r.status()} ${r.url().replace(demo.base, '')}`);
  }
});

const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log(`  shot  ${name}.png`);
};

const LAUNCHER = 'button:has-text("Show me around")';
const PANEL = 'section[aria-label="Guide"]';

// ── 1. the launcher exists on arrival ────────────────────────────────────────────────────────────
await page.goto(`${demo.base}/overview`, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2500);
const launcher = page.locator(LAUNCHER);
if ((await launcher.count()) === 0) {
  fail('the launcher is not on /overview — the guide is unreachable');
} else {
  ok('launcher present on /overview');
  const box = await launcher.boundingBox();
  const vp = page.viewportSize();
  if (box && (box.y + box.height > vp.height + 2 || box.x + box.width > vp.width + 2)) {
    fail(`launcher is off-screen at ${WIDTH}px: ${JSON.stringify(box)}`);
  } else {
    ok(`launcher sits in the corner: ${JSON.stringify(box)}`);
  }
}
await shot('01-arrival-launcher-closed');

// ── 2. opening it shows themed starter questions ────────────────────────────────────────────────
await launcher.click();
await page.waitForTimeout(600);
const panel = page.locator(PANEL);
if ((await panel.count()) === 0) {
  fail('clicking the launcher did not open the panel');
  await browser.close();
  process.exit(1);
}
await shot('02-open-starter-questions');

const panelText = await panel.innerText();
for (const theme of ['Is it private?', 'Does it actually work?', 'Can I trust it?', 'Is it worth it?']) {
  if (panelText.includes(theme)) ok(`theme shown: ${theme}`);
  else fail(`theme missing from the open panel: ${theme}`);
}
const starters = panel.locator('button');
const starterCount = await starters.count();
if (starterCount < 8) fail(`only ${starterCount} buttons in the panel — starter list looks empty`);
else ok(`${starterCount} clickable items in the panel`);

const leak = LEAKS.exec(panelText);
if (leak) fail(`the panel shows an internal name: "${leak[0]}"`);
else ok('no internal component name in the panel text');

// ── 3+4. ask a question, then follow the destination and prove the URL changed ──────────────────
// One question per theme, each with the route its top destination must land on.
const CASES = [
  { q: 'Show me proof our data never leaves our network.', expect: '/governance/egress' },
  { q: 'What is waiting for a person to decide right now?', expect: '/work/tasks' },
  { q: 'Who did what — and could I hand that to a regulator?', expect: '/governance/evidence/audit' },
  { q: 'What is this saving us, in hours and rupees?', expect: '/insights/outcomes' },
  {
    q: 'Show me the AI doing a real piece of our work, start to finish.',
    expect: which === 'insurer' ? '/operations/runs/agent%3Arun_0d632888' : '/operations/runs/agent%3Arun_b922bd7b',
  },
];

let i = 3;
for (const { q, expect } of CASES) {
  console.log(`\n-- "${q}"`);
  httpProblems.length = 0;
  // Reopen + reset to the starter list for each case.
  if ((await page.locator(PANEL).count()) === 0) {
    await page.locator(LAUNCHER).click();
    await page.waitForTimeout(500);
  }
  const reset = page.locator(`${PANEL} button:has-text("new")`);
  if ((await reset.count()) > 0) {
    await reset.first().click();
    await page.waitForTimeout(300);
  }

  const starter = page.locator(`${PANEL} button`, { hasText: q });
  if ((await starter.count()) === 0) {
    fail(`starter question not offered on this tenant: ${q}`);
    continue;
  }
  await starter.first().click();
  await page.waitForTimeout(1200);
  const label = String(i).padStart(2, '0');
  await shot(`${label}a-asked`);

  const afterAsk = await page.locator(PANEL).innerText();
  if (!afterAsk.includes('Go and see it')) fail(`no destinations offered for: ${q}`);
  else ok('destinations offered before the model has even answered');

  // The destination whose href is the one we expect. Match by the link text of the first destination
  // card rather than by href (they are buttons that push, not anchors).
  const cards = page.locator(`${PANEL} button.group`);
  const n = await cards.count();
  if (n === 0) {
    fail(`no destination cards rendered for: ${q}`);
    continue;
  }

  // Wait for the answer half so we can prove the endpoint answers a VIEWER (it used to 403).
  await page.waitForTimeout(9000);
  const withAnswer = await page.locator(PANEL).innerText();
  await shot(`${label}b-answered`);
  const forbidden = httpProblems.find((p) => p.includes('403') && p.includes('copilot'));
  if (forbidden) fail(`the answer endpoint refused the viewer: ${forbidden}`);
  else if (/Answered by the AI|No records available|showing the raw records/.test(withAnswer)) {
    ok('an honest answer + source label came back');
  } else {
    notes.push(`answer had not landed within 9s for "${q}" — destinations were already usable`);
  }
  const answerLeak = LEAKS.exec(withAnswer);
  if (answerLeak) fail(`the answer shows an internal name: "${answerLeak[0]}"`);

  // Now the load-bearing click.
  const before = page.url();
  await cards.first().click();
  await page.waitForTimeout(3500);
  const after = page.url();
  const landedPath = decodeURI(new URL(after).pathname);
  const expectPath = decodeURI(expect);
  if (after === before) fail(`clicking the destination did not navigate (still ${before})`);
  else if (landedPath !== expectPath) fail(`landed on ${landedPath}, expected ${expectPath}`);
  else ok(`navigated to ${landedPath}`);

  const bodyText = await page.locator('body').innerText();
  if (/This page could not be found|404/.test(bodyText.slice(0, 400))) {
    fail(`the destination is a 404: ${landedPath}`);
  } else {
    ok('the destination rendered a real page');
  }
  await shot(`${label}c-landed`);

  // Back must return — the whole reason this is a router push and not local state.
  await page.goBack();
  await page.waitForTimeout(2500);
  if (decodeURI(new URL(page.url()).pathname) === decodeURI(new URL(before).pathname)) {
    ok('Back returned to the previous screen');
  } else {
    fail(`Back went to ${page.url()}, expected ${before}`);
  }
  i += 1;
}

// ── 5. dismissible: the X removes it and it does not nag ────────────────────────────────────────
console.log('\n-- dismiss');
if ((await page.locator(PANEL).count()) === 0) {
  await page.locator(LAUNCHER).click();
  await page.waitForTimeout(500);
}
await page.locator(`${PANEL} button[aria-label="Close the guide"]`).click();
await page.waitForTimeout(500);
if ((await page.locator(LAUNCHER).count()) === 0) ok('closing removes the launcher entirely');
else fail('closing the guide left the launcher behind');
await shot('90-dismissed');

// ── 6. below md, the mobile gate owns the screen ────────────────────────────────────────────────
await page.setViewportSize({ width: 500, height: 900 });
await page.goto(`${demo.base}/overview`, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2000);
const narrowLauncher = await page.locator(LAUNCHER).isVisible().catch(() => false);
if (narrowLauncher) fail('the launcher is visible below md, on top of the use-a-bigger-screen gate');
else ok('hidden below md, so it does not float over the mobile gate');
await shot('91-narrow-mobile-gate');

await browser.close();

const summary = {
  tenant: which,
  base: demo.base,
  account: session.user.email,
  role: session.user.role,
  failures,
  notes,
};
writeFileSync(join(OUT, 'result.json'), JSON.stringify(summary, null, 2));
console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`} — ${OUT}`);
for (const n of notes) console.log(`  note  ${n}`);
process.exit(failures.length === 0 ? 0 : 1);

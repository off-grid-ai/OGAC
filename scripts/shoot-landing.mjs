// Landing-page screenshot harness — logs into the LIVE console via Keycloak, forces LIGHT theme
// for a uniform gallery, and captures the product surfaces the landing page features. Modeled on
// scripts/shoot-walkthrough.mjs (login flow) + desktop/scripts/screenshots-pro.mjs (clean framing).
//
//   BASE=https://onprem-console.getoffgridai.co KC_USER=mac@example.com KC_PASS=changeme \
//   OUT=/tmp/landing-shots node scripts/shoot-landing.mjs
//
// Viewport shots (not full-page) so each reads like a framed product hero. High DPI for crisp retina.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'https://onprem-console.getoffgridai.co';
const OUT = process.env.OUT || '/tmp/landing-shots';
const KC_USER = process.env.KC_USER || 'mac@example.com';
const KC_PASS = process.env.KC_PASS || 'changeme';
const REIMB = process.env.REIMB_APP || 'app_bdd24eab';
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

console.log('login via keycloak…');
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /Continue with Keycloak/i }).click();
await page.waitForSelector('#username', { timeout: 20000 });
await page.fill('#username', KC_USER);
await page.fill('#password', KC_PASS);
await page.click('#kc-login, input[type=submit], button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/signin') && !u.href.includes(':8080'), { timeout: 25000 });
console.log('logged in →', page.url());

// Force light theme (next-themes, attribute=data-theme, default storageKey 'theme').
await page.evaluate(() => { localStorage.setItem('theme', 'light'); });
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(1500);

const shot = async (name) => { await wait(1200); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('✓', name); };
const go = async (route) => { await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' }); await wait(2200); };

// ── HERO: the builder mid-sentence (the money shot) ──────────────────────────────────────────────
await go('studio/new');
try {
  // Type a plain-language process description into the first large text input the builder exposes.
  const box = page.locator('textarea, input[type=text]').first();
  await box.click({ timeout: 6000 });
  await box.fill(
    'When a reimbursement request comes in, read the invoice, check the employee’s remaining quota, ' +
    'and if they’re within it, approve it — otherwise send it to finance for review.',
  );
  await wait(1500);
} catch (e) { console.error('hero typing skipped:', e.message); }
await shot('hero-builder');

// ── The reimbursement app: the 5-screen lifecycle + a governed run ────────────────────────────────
await go(`apps/${REIMB}`); await shot('app-lifecycle');
await go(`apps/${REIMB}/runs`); await shot('app-runs');
await go(`apps/${REIMB}/review`); await shot('app-review');
await go(`apps/${REIMB}/reports`); await shot('app-reports');

// ── Supporting: grounded chat, agents catalog, evals (honest tags), data domains ──────────────────
await go('chat'); await shot('chat');
await go('studio'); await shot('studio');
await go('evals'); await shot('evals');
await go('data'); await shot('data');

await browser.close();
console.log('done →', OUT);

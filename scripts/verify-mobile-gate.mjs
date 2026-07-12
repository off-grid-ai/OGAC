// Verify the console mobile-block gate: at phone width (<md) the "bigger screen" gate covers the
// app; at desktop width it is absent. Dev-login first (same flow as shoot.mjs). Asserts the terminal
// artifact — what the user actually SEES — at each viewport, then screenshots both for the eye check.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const OUT = process.env.OUT || '/tmp/shots';
const GATE = /Open this on a bigger screen/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /Dev sign-in/i }).click();
await page.waitForURL((u) => !u.pathname.endsWith('/signin'), { timeout: 20000 });
await page.waitForTimeout(1500);

let failures = 0;
const check = async (label, w, h, shouldSee) => {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  const visible = await page.getByRole('heading', { name: GATE }).isVisible().catch(() => false);
  const ok = visible === shouldSee;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} (${w}px): gate visible=${visible}, expected=${shouldSee}`);
  await page.screenshot({ path: `${OUT}/mobile-gate-${w}.png`, fullPage: false });
};

await check('phone', 390, 844, true);
await check('narrow-tablet-just-under', 767, 1024, true);
await check('tablet', 768, 1024, false);
await check('desktop', 1440, 1024, false);

await browser.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

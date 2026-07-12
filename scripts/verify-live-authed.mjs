// Authed live-verify harness — screenshot real console surfaces of the LIVE on-prem box WITHOUT
// hitting Cloudflare Access. Set up an SSH local-forward of the box's app + Keycloak ports over the
// cloudflared SSH channel first:
//
//   ssh -f -N -L 3000:127.0.0.1:3000 -L 8080:127.0.0.1:8080 offgrid-tunnel
//
// then log in with a tenant's read-only DEMO viewer creds (the box exposes them per-tenant, e.g.
// OFFGRID_DEMO_VIEWER_BHARATUNION_EMAIL/PASSWORD) via the credentials form on /signin — no Cloudflare
// Access, no dev-login (prod build), just the app's own login against real live data.
//
//   DEMO_USER=demo-bank@…  DEMO_PASS=…  ROUTES=/overview,/build/pipelines  OUT=/tmp/shots \
//     node scripts/verify-live-authed.mjs
//
// Saves cookies to $OUT/state.json so re-runs skip the login. Prints [status] url h1 per route.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp/shots';
const USER = process.env.DEMO_USER;
const PASS = process.env.DEMO_PASS;
const ROUTES = (process.env.ROUTES || '/overview').split(',').map((r) => r.trim()).filter(Boolean);
const WAIT = Number(process.env.WAIT_MS || 3500);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// Log in through the credentials form (username/password) on /signin.
await page.goto(`${BASE}/signin?callbackUrl=%2Foverview`, { waitUntil: 'networkidle', timeout: 25000 });
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForTimeout(4000);

for (const route of ROUTES) {
  const name = route.replace(/^\//, '').replace(/\//g, '_') || 'root';
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(WAIT);
    const h1 = await page.locator('h1').first().innerText().catch(() => '');
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    console.log(`${name} [${resp?.status()}] ${page.url().replace(BASE, '')} h1="${h1.slice(0, 48)}"`);
  } catch (e) {
    console.log(`${name} ERR ${String(e.message).slice(0, 70)}`);
  }
}

await ctx.storageState({ path: `${OUT}/state.json` });
await browser.close();

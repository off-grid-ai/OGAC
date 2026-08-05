#!/usr/bin/env node
// Read-only link extractor reusing audit-shoot.mjs's login flow, to find real ids for [id] detail routes.
import { chromium } from 'playwright';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const DEMO = {
  insurer: { base: 'https://suraksha-onprem-console.getoffgridai.co', email: 'demo-insurer@getoffgridai.co', password: 'OffGridDemo2026!' },
  bank: { base: 'https://bharatunion-onprem-console.getoffgridai.co', email: 'demo-bank@getoffgridai.co', password: 'OffGridDemo2026!' },
};
const demo = DEMO[arg('demo', '')] ?? null;
const BASE = arg('base', demo?.base ?? 'http://127.0.0.1:3005').replace(/\/$/, '');
const EMAIL = arg('email', demo?.email ?? 'dev@offgrid.local');
const PASSWORD = arg('password', demo?.password ?? 'dev');
const PROVIDER = arg('provider', demo ? 'password' : 'dev');
const ROUTE = arg('route', '/');
const MATCH = arg('match', '');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()).csrfToken;
await ctx.request.post(`${BASE}/api/auth/callback/${PROVIDER}`, {
  form: PROVIDER === 'password' ? { csrfToken: csrf, username: EMAIL, password: PASSWORD, callbackUrl: '/' } : { csrfToken: csrf, email: EMAIL, password: PASSWORD, callbackUrl: '/' },
  maxRedirects: 0,
});
const session = await (await ctx.request.get(`${BASE}/api/auth/session`)).json();
if (!session?.user) { console.error('SIGN-IN FAILED'); process.exit(1); }
console.log(`signed in as ${session.user.email}`);

const page = await ctx.newPage();
await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')));
const uniq = [...new Set(hrefs)].filter(h => !MATCH || h.includes(MATCH));
console.log(JSON.stringify(uniq, null, 2));
await browser.close();

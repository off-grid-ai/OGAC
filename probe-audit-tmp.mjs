import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:3005';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()).csrfToken;
await ctx.request.post(`${BASE}/api/auth/callback/dev`, {
  form: { csrfToken: csrf, email: 'dev@offgrid.local', password: 'dev', callbackUrl: `${BASE}/` },
  maxRedirects: 0,
}).catch(() => {});
for (const p of process.argv.slice(2)) {
  const r = await ctx.request.get(`${BASE}${p}`);
  const t = await r.text();
  console.log(`\n=== ${p} -> ${r.status()}\n${t.slice(0, 3000)}`);
}
await browser.close();

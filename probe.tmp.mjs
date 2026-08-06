import { chromium } from 'playwright';
const B = 'https://bharatunion-onprem-console.getoffgridai.co';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto(`${B}/signin?callbackUrl=%2Foverview`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(18000);
const d = await p.evaluate(async () => {
  for (const u of ['/api/v1/finops', '/api/v1/admin/finops']) {
    const r = await fetch(u, { cache: 'no-store' });
    if (r.ok) return { u, body: await r.json() };
  }
  return null;
});
if (!d) { console.log('no finops api reachable'); } else {
  console.log(d.u, 'totals=', JSON.stringify(d.body.totals ?? d.body?.finops?.totals));
  const bm = d.body.byModel ?? d.body?.finops?.byModel ?? [];
  for (const m of bm.slice(0, 15)) console.log('   ', m.label, m.requests, m.costUsd);
}
await b.close();

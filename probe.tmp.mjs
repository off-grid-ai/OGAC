import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [name, B] of [['insurer','https://suraksha-onprem-console.getoffgridai.co'],['bank','https://bharatunion-onprem-console.getoffgridai.co']]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  await p.goto(`${B}/signin?callbackUrl=%2Foverview`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForTimeout(20000);
  console.log(`== ${name} landed: ${p.url().replace(B, '')}`);
  const d = await p.evaluate(async () => {
    const r = await fetch('/api/v1/admin/guide/proof', { cache: 'no-store' });
    return r.ok ? await r.json() : { err: r.status };
  });
  for (const pt of d.points ?? []) console.log(`   ${pt.id}: ${pt.value}`);
  if (d.err) console.log('   ERR', d.err);
  await p.screenshot({ path: `/tmp/shot-${name}.png` });
  await ctx.close();
}
await b.close();

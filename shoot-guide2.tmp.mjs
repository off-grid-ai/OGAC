import { chromium } from 'playwright';
const OUT = process.env.OUT;
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: `${OUT}/state.json`, viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
await p.goto('http://localhost:3000/overview', { waitUntil: 'networkidle', timeout: 40000 });
await p.getByRole('button', { name: /show me around/i }).click();
await p.waitForTimeout(1000);
// Click the shipped starter verbatim so the destination matcher gets an exact match.
await p.getByRole('button', { name: /Who did what — and could I hand that to a regulator\?/i }).click();
// Wait for the answer to replace the loading line, up to 3 minutes.
for (let i = 0; i < 36; i++) {
  await p.waitForTimeout(5000);
  const txt = await p.locator('section[aria-label="Guide"]').innerText();
  if (!txt.includes('Reading the live records')) { console.log('answer arrived after', (i + 1) * 5, 's'); break; }
}
await p.screenshot({ path: `${OUT}/guide-answer-rendered.png` });
const txt = await p.locator('section[aria-label="Guide"]').innerText();
console.log('--- has literal markdown? ---');
for (const m of ['**', '- ', '##']) console.log(JSON.stringify(m), txt.includes(m) ? 'PRESENT (raw!)' : 'absent (rendered)');
await b.close();

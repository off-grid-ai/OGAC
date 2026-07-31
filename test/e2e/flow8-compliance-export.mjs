// §10 Flow 8: select a scope, collect runs/policies/approvals/versions, generate a SIGNED evidence pack.
// The artifact is the pack: it must be produced and it must carry a signature or digest. A page that
// merely offers a button is WIRED, not this flow.
import { signIn, verdict, waitFor, OUT } from './lib.mjs';
const ROW = 'flow8-compliance-export';
const { browser, page } = await signIn(process.env.PACK_ROUTE || '/governance/evidence');
const gen = page.getByRole('button', { name: /generate|export|create pack|build pack/i }).first();
if (!(await gen.count())) {
  verdict(ROW, false, `no generate/export control on ${process.env.PACK_ROUTE || '/governance/evidence'}`);
  await page.screenshot({ path: `${OUT}/${ROW}.png` }).catch(() => {});
  await browser.close(); process.exit(1);
}
await gen.click();
// The pack is evidence only if it is identifiable and tamper-evident: a digest, signature or pack id.
const ok = await waitFor(async () => {
  const t = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  return /\b(sha256|signature|signed|digest)\b/i.test(t) || /pack_[a-z0-9]{6,}/i.test(t);
}, 60000);
const t = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 220);
await page.screenshot({ path: `${OUT}/${ROW}.png` }).catch(() => {});
verdict(ROW, ok, ok ? `pack evidence present: "${t}"` : `no digest/signature/pack id after generate: "${t}"`);
await browser.close(); process.exit(ok ? 0 : 1);

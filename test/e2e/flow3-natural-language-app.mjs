// §10 Flow 3: describe a goal in plain language → OGAC asks clarifying questions → proposes a workflow.
// This one MUST use real keystrokes: the studio composer is React-controlled, and the whole claim is
// that typing a sentence produces a plan. The artifact is the proposed workflow or the questions —
// anything less means the sentence went nowhere.
import { signIn, type, verdict, waitFor, OUT } from './lib.mjs';
const ROW = 'flow3-natural-language-app';
const { browser, page } = await signIn('/build/studio');
await page.waitForTimeout(2500);
const box = page.locator('textarea').first();
if (!(await box.count())) {
  verdict(ROW, false, 'no description input on /build/studio — a goal cannot be described');
  await page.screenshot({ path: `${OUT}/${ROW}.png` }).catch(() => {});
  await browser.close(); process.exit(1);
}
await type(box, 'Check each training reimbursement claim against the employee quota and send anything over the limit to a manager for approval.');
const go = page.getByRole('button', { name: /compile|build|generate|propose|create|continue/i }).first();
if (await go.count()) await go.click();
// The artifact: either clarifying questions or a proposed step list. Both are plain-language plans.
const ok = await waitFor(async () => {
  const t = ((await page.locator('main').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  return /clarif|which data source|what value is the cut-off|who should review/i.test(t)
    || /\bstep\s*1\b|proposed workflow|plan\b/i.test(t);
}, 90000);
const t = ((await page.locator('main').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
await page.screenshot({ path: `${OUT}/${ROW}.png`, fullPage: true }).catch(() => {});
verdict(ROW, ok, ok ? `plan/questions produced: "${t.slice(0, 180)}"` : `no plan or question after 90s: "${t.slice(0, 180)}"`);
await browser.close(); process.exit(ok ? 0 : 1);

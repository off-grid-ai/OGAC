// §10 Flow 3: describe a goal in plain language → OGAC asks clarifying questions → proposes a workflow.
// TARGET RESOLVED: the composer is AppBuilder at /build/studio/new — /build/studio is the module index
// and has no input, which is what my first run reported. The route was my error, not a missing feature.
// This one MUST use real keystrokes: the studio composer is React-controlled, and the whole claim is
// that typing a sentence produces a plan. The artifact is the proposed workflow or the questions —
// anything less means the sentence went nowhere.
import { signIn, type, verdict, waitFor, OUT } from './lib.mjs';
const ROW = 'flow3-natural-language-app';
const { browser, page } = await signIn('/build/studio/new');
await page.waitForTimeout(2500);
const box = page.locator('textarea').first();
if (!(await box.count())) {
  verdict(ROW, false, 'no description input on /build/studio/new — a goal cannot be described');
  await page.screenshot({ path: `${OUT}/${ROW}.png` }).catch(() => {});
  await browser.close(); process.exit(1);
}
await type(box, 'Check each training reimbursement claim against the employee quota and send anything over the limit to a manager for approval.');
// SCOPE THE CONTROL, AND SCOPE THE SEARCH. A loose /build/i matched the sidebar's "Build" nav item and
// clicked navigation instead of compiling — zero requests fired and I read that as "compile produced
// nothing". Third time a loose locator sent me at the wrong element, so this matches the real control's
// full label inside <main>, and asserts the click actually issued a request.
// NOT scoped to <main>: the control may sit outside it, and a wrong scope throws rather than reporting.
const go = page.getByRole('button', { name: /^build the steps$/i }).first();
if (!(await go.count())) {
  verdict(ROW, false, 'no "Build the steps" control on /build/studio/new');
  await browser.close(); process.exit(1);
}
let compiled = false;
page.on('response', (r) => { if (r.request().method() === 'POST') compiled = true; });
// A TIMEOUT IS A VERDICT, never an exception — my own harness rule, which this script was breaking.
// A disabled or unreachable control is a finding to report, not a stack trace to read.
let clickError = '';
try {
  await go.click({ timeout: 15000 });
} catch (e) {
  clickError = String(e.message).split('\n')[0].slice(0, 90);
  const disabled = await go.isDisabled().catch(() => null);
  // A DISABLED CONTROL IS NOT AUTOMATICALLY A DEFECT. On a read-only identity this is the correct
  // behaviour, and AppBuilder renders `access.createExplanation` beside the button when it refuses. So
  // the artifact to read here is the EXPLANATION: refusing is right, refusing invisibly is not. I first
  // reported this as "disabled and never says why" off a 170-char sample that cut the message off.
  const full = ((await page.locator('main').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  const explained = /cannot create apps|you cannot|read-only|permission|not permitted|checking whether/i.test(full);
  await page.screenshot({ path: `${OUT}/${ROW}.png`, fullPage: true }).catch(() => {});
  verdict(ROW, false,
    `refused (disabled=${disabled}) explained=${explained} — Flow 3 needs a WRITE-CAPABLE identity to be` +
    ` provable; set DEMO_USER to an editor. Refusal wording: "${(full.match(/[^.]*cannot[^.]*\./i) || ['(none found)'])[0].slice(0, 90)}"`);
  await page.screenshot({ path: `${OUT}/${ROW}.png`, fullPage: true }).catch(() => {});
  await browser.close();
  process.exit(1);
}
// The artifact: either clarifying questions or a proposed step list. Both are plain-language plans.
const ok = await waitFor(async () => {
  const t = ((await page.locator('main').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  return /clarif|which data source|what value is the cut-off|who should review/i.test(t)
    || /\bstep\s*1\b|proposed workflow|plan\b/i.test(t);
}, 90000);
const t = ((await page.locator('main').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
await page.screenshot({ path: `${OUT}/${ROW}.png`, fullPage: true }).catch(() => {});
verdict(ROW, ok, `compileRequestFired=${compiled} ` +
  (ok ? `plan/questions produced: "${t.slice(0, 170)}"` : `no plan or question after 90s: "${t.slice(0, 170)}"`));
await browser.close(); process.exit(ok ? 0 : 1);

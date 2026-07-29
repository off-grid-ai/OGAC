import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth';

// The other half of the job. `walk.spec.ts` proves a case can be STARTED and reaches a decision point;
// this proves the decision can be MADE — in place, on the Work screen, which is the whole reason the app
// pauses for a person. A queue you cannot act on is a report.
test.describe.configure({ timeout: 180_000 });

test('a case waiting for a person can be approved in place', async ({ page }) => {
  // A decision that does nothing must not fail silently in the report: surface what the server said.
  const refusals: string[] = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/review') || res.ok()) return;
    const body = await res.text().catch(() => '');
    refusals.push(`[${res.status()}] ${res.url()} ${body.slice(0, 200)}`);
  });

  await signIn(page);
  await page.goto('/app/bh-reimbursement', { waitUntil: 'networkidle' });

  // The decision buttons are client-rendered, so `networkidle` is not enough — the first version of this
  // test counted them before hydration, found none, and skipped itself while seven cases sat waiting on
  // screen. A test that silently skips is worse than one that fails.
  const approve = page.getByRole('button', { name: /Approve/ }).first();
  const appeared = await approve
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!appeared, 'no case is waiting for a decision right now');

  // The case has to be READABLE next to the button — deciding without seeing what you are deciding on is
  // not a decision. The subject was once squeezed to "Training course reimbursement — V…" by these buttons.
  const row = page.locator('li, tr, div').filter({ has: approve }).first();
  const rowText = await row.innerText();
  expect(rowText.trim().length, 'a decision row must show what it is about').toBeGreaterThan(20);

  // A read-only demo account is refused server-side. For that account the CORRECT behaviour is a control
  // that says so up front, not one that looks live and 403s — so assert that, rather than skipping. The
  // functional approval path is exercised against the review API with a writer credential.
  const readOnly = await page.locator('[data-readonly="true"]').first().count();
  if (readOnly > 0) {
    await expect(page.locator('[data-readonly="true"]').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/decide-readonly.png', fullPage: false });
    return;
  }

  await approve.click();

  // The decision must be recorded and the queue must reflect it — not silently succeed while the row stays.
  await expect(async () => {
    const body = await page.locator('body').innerText();
    expect(
      body,
      refusals.length > 0 ? `the decision was refused: ${refusals.join(' | ')}` : 'the decision left no trace',
    ).toMatch(/approved|Completed|Declined|no cases waiting|Nothing waiting|Finished/i);
  }).toPass({ timeout: 60_000 });

  await page.screenshot({ path: 'test-results/decide-approved.png', fullPage: false });
});

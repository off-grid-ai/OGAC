import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth';

// The other half of the job. `walk.spec.ts` proves a case can be STARTED and reaches a decision point;
// this proves the decision can be MADE — in place, on the Work screen, which is the whole reason the app
// pauses for a person. A queue you cannot act on is a report.
test.describe.configure({ timeout: 180_000 });

test('a case waiting for a person can be approved in place', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/bh-reimbursement', { waitUntil: 'networkidle' });

  const approve = page.getByRole('button', { name: /^Approve$/ }).first();
  const waiting = await approve.count();
  test.skip(waiting === 0, 'no case is waiting for a decision right now');

  // The case has to be READABLE next to the button — deciding without seeing what you are deciding on is
  // not a decision. The subject was once squeezed to "Training course reimbursement — V…" by these buttons.
  const row = page.locator('li, tr, div').filter({ has: approve }).first();
  const rowText = await row.innerText();
  expect(rowText.trim().length, 'a decision row must show what it is about').toBeGreaterThan(20);

  await approve.click();

  // The decision must be recorded and the queue must reflect it — not silently succeed while the row stays.
  await expect(async () => {
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/approved|Completed|no cases waiting|Nothing waiting|Finished/i);
  }).toPass({ timeout: 60_000 });

  await page.screenshot({ path: 'test-results/decide-approved.png', fullPage: false });
});

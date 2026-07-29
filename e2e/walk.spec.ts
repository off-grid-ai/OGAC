import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth';

// The walk a clerk actually takes. Feature-by-feature checks passed while this path dead-ended in
// "(no output)", so this asserts the JOURNEY: land on the app, pick a real case, run it, and be told what
// happened and what to do next.
test('a clerk can land, pick a case, run it, and be told what happened', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/bh-reimbursement?view=run', { waitUntil: 'networkidle' });

  // A real record from the org's own data, not a text box. Matched on the picker's own affordance
  // (aria-pressed) rather than on a name pattern: the cases are whatever the org's data holds, and a test
  // that hard-codes "Vendor 255" starts asserting the seed data instead of the behaviour.
  const firstCase = page.locator('button[aria-pressed]').first();
  await expect(firstCase).toBeVisible();
  await firstCase.click();

  await page.getByRole('button', { name: /^Run$/ }).click();

  // Wait for the RUN to settle, not merely for the word "Result" to appear somewhere — a governed run reads
  // data, calls a model and writes a report, so it takes real time and the button shows "Running…". The first
  // version of this test asserted while that was still on screen and reported a failure that was only impatience.
  await expect(page.getByRole('button', { name: /Running/i })).toHaveCount(0, { timeout: 120_000 });

  const body = await page.locator('body').innerText();
  // The whole point: a terminal state must never be silence.
  expect(body, 'a run must never end in "(no output)"').not.toContain('(no output)');
  // It must say what happened AND where to look next.
  expect(body).toMatch(/view-only access|waiting for you under Work|appear under Activity|step-by-step trail|Completed|approved|rejected/i);
  // A per-case app must have decided about THAT case: a real recommendation, in rupees. This is the
  // assertion that would have failed for weeks while the reads returned twenty unrelated rows.
  expect(body, 'the run must reach a decision, not a shrug').toMatch(/within quota|within pool|exceeds remaining|partially approve|Waiting for you/i);
  await page.screenshot({ path: 'test-results/walk-run.png', fullPage: false });
});

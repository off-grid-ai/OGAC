import { test, expect } from '@playwright/test';
import { signIn } from './helpers/auth';

// The walk a clerk actually takes. Feature-by-feature checks passed while this path dead-ended in
// "(no output)", so this asserts the JOURNEY: land on the app, pick a real case, run it, and be told what
// happened and what to do next.
test('a clerk can land, pick a case, run it, and be told what happened', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/bh-reimbursement?view=run', { waitUntil: 'networkidle' });

  // A real record from the org's own data, not a text box.
  const firstCase = page.getByRole('button', { name: /Vendor \d+/ }).first();
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
  await page.screenshot({ path: 'test-results/walk-run.png', fullPage: false });
});

import type { Page } from '@playwright/test';

/**
 * Sign in through the console's OWN credentials form — the same path an operator takes.
 *
 * Deliberately not a cookie injection or a test-only bypass: an auth flow that the suite skips is an
 * auth flow the suite cannot catch breaking. Credentials come from env so the suite can run against
 * a local dev server or the live box without code changes.
 */
export async function signIn(page: Page): Promise<void> {
  const user = process.env.OFFGRID_E2E_USER;
  const pass = process.env.OFFGRID_E2E_PASS;
  if (!user || !pass) {
    throw new Error('OFFGRID_E2E_USER and OFFGRID_E2E_PASS are required to run the console e2e suite');
  }

  await page.goto('/signin?callbackUrl=%2Foverview', { waitUntil: 'networkidle' });
  await page.fill('input[name=username]', user);
  await page.fill('input[name=password]', pass);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 30_000 });
}

/**
 * The computed value of a design token, read from the live document; `''` if it is not declared.
 *
 * The empty-string case matters: `var(--nope)` resolves to the INHERITED colour rather than failing,
 * so a token that does not exist reads back as a perfectly plausible wrong colour. Checking that the
 * property is declared first is what separates "the accent is off-brand" from "the accent is gone".
 */
export async function tokenValue(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    if (!getComputedStyle(document.documentElement).getPropertyValue(name).trim()) return '';
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

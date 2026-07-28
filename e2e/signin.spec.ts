import { test, expect } from '@playwright/test';

/**
 * The signin page is the whole product's front door and needs no session, so it gets its own spec.
 *
 * What this locks: a visitor who arrives at the APEX host has somewhere to go. Previously the two
 * read-only demo tenants lived on their own subdomains and nothing on this page pointed at them, so an
 * account-less visitor hit a dead end at the one URL they were most likely to be given.
 */

test('the signin page always offers a way in, or says plainly that none is configured', async ({
  page,
}) => {
  await page.goto('/signin', { waitUntil: 'networkidle' });

  // Which providers exist is environment-dependent (password needs the identity backend; SSO needs
  // client credentials), so asserting a SPECIFIC provider would only test the local .env. The real
  // invariant is that the page never leaves a visitor with nothing: either some sign-in control is
  // present, or the page states outright that no method is configured.
  const controls = await page
    .getByRole('button', { name: /sign in|continue with|dev sign-in/i })
    .count();
  const saysNone = await page.getByText(/no sign-in method configured/i).count();
  expect(controls + saysNone, 'the page must offer a way in or explain its absence').toBeGreaterThan(
    0,
  );

  // A page that renders an error boundary is broken even behind a 200.
  await expect(page.getByText(/application error|unhandled runtime/i)).toHaveCount(0);
});

test('the apex signin page links to both demo tenants, bank and insurer', async ({ page }) => {
  await page.goto('/signin', { waitUntil: 'networkidle' });

  const bank = page.getByRole('link', { name: /Bharat Union/i });
  const insurer = page.getByRole('link', { name: /Suraksha Life/i });
  await expect(bank).toBeVisible();
  await expect(insurer).toBeVisible();

  // Each must point at that tenant's OWN console host — the whole point is crossing hosts.
  expect(await bank.getAttribute('href')).toMatch(
    /^https:\/\/bharatunion-onprem-console\.getoffgridai\.co\//,
  );
  expect(await insurer.getAttribute('href')).toMatch(
    /^https:\/\/suraksha-onprem-console\.getoffgridai\.co\//,
  );

  // Both are read-only demos and the page must say so rather than implying a live account.
  const body = await page.locator('body').innerText();
  expect(body).toMatch(/read-only/i);
});

test('the signin card does not scroll the page sideways', async ({ page }) => {
  await page.goto('/signin', { waitUntil: 'networkidle' });
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

import { test, expect, type Page } from '@playwright/test';
import { signIn, tokenValue } from './helpers/auth';

/**
 * UI/UX verification for the console — the gate that unit tests and API probes cannot close.
 *
 * Every assertion here is something a functional test would pass while the operator's experience is
 * broken: content rendered off-screen, a focus ring that is invisible, a page that scrolls sideways,
 * a hardcoded colour that ignores the theme. The repo has already shipped two of these (a summary
 * badge claiming "no decline detected" while every row said "not enough data", and score columns
 * pushed out of view by an unwrapped sentence) — both caught by eye, neither by a test.
 *
 * Brand source of truth: brand/DESIGN_PHILOSOPHY.md.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

/** The surfaces an operator actually lives in. Each must satisfy the shared bar below. */
const OPERATOR_SURFACES = [
  { path: '/overview', name: 'Overview' },
  { path: '/solutions/quality/drift', name: 'Quality drift' },
  { path: '/insights/accounting', name: 'Accounting' },
  { path: '/insights/audit', name: 'Audit log' },
  { path: '/operations/runs', name: 'Runs' },
];

for (const surface of OPERATOR_SURFACES) {
  test(`${surface.name}: fills the width without scrolling the page sideways`, async ({ page }) => {
    await page.goto(surface.path, { waitUntil: 'networkidle' });

    // The single most-repeated design instruction in this repo is "use the full width — no wasted
    // real estate". A page that leaves a large empty gutter on a 1440px screen is a defect.
    const { bodyScrollWidth, clientWidth, mainWidth } = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      return {
        bodyScrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        mainWidth: main.getBoundingClientRect().width,
      };
    });

    // Wide content (tables, diagrams) must scroll inside its OWN container, never the page body.
    expect(bodyScrollWidth, `${surface.name} must not scroll horizontally`).toBeLessThanOrEqual(
      clientWidth + 1,
    );
    // The content region should use most of the viewport, not sit in a skinny centred column.
    expect(mainWidth, `${surface.name} should fill the available width`).toBeGreaterThan(
      clientWidth * 0.6,
    );
  });

  test(`${surface.name}: renders its heading and no visibly broken state`, async ({ page }) => {
    const response = await page.goto(surface.path, { waitUntil: 'networkidle' });
    expect(response?.status(), `${surface.name} should load`).toBeLessThan(400);

    await expect(page.locator('h1').first()).toBeVisible();
    // A surface that renders an unhandled error boundary is broken even if the route returns 200.
    await expect(page.getByText(/application error|unhandled runtime|something went wrong/i)).toHaveCount(0);
  });
}

test('the accent colour is the brand emerald, in whichever theme is active', async ({ page }) => {
  await page.goto('/overview', { waitUntil: 'networkidle' });

  // brand/DESIGN_PHILOSOPHY.md §3: emerald is the ONLY accent — #34D399 dark, #059669 light.
  // `--og-primary` is the source token; Tailwind's `--color-primary` is an alias of it.
  const primary = await tokenValue(page, '--og-primary');
  const [r, g, b] = (primary.match(/\d+/g) ?? []).map(Number);

  expect(primary, 'the --og-primary accent token must be declared and resolve to a colour').toMatch(
    /^rgb/,
  );
  // Green-dominant is the assertion that survives a token refactor; exact hex would not.
  expect(g, `accent should be green-dominant, got ${primary}`).toBeGreaterThan(r);
  expect(g, `accent should be green-dominant, got ${primary}`).toBeGreaterThan(b);
});

test('keyboard focus is always visible — an operator can see where they are', async ({ page }) => {
  await page.goto('/overview', { waitUntil: 'networkidle' });

  // Tab to the first genuinely focusable control and require a visible focus indicator. An
  // invisible focus ring makes the console unusable by keyboard while looking perfectly fine.
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus-visible');
  await expect(focused, 'something should receive visible focus on the first Tab').toHaveCount(1);

  const indicator = await focused.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      outlineWidth: parseFloat(s.outlineWidth) || 0,
      outlineStyle: s.outlineStyle,
      boxShadow: s.boxShadow,
      ring: s.getPropertyValue('--tw-ring-offset-shadow'),
    };
  });

  const hasIndicator =
    (indicator.outlineWidth > 0 && indicator.outlineStyle !== 'none') ||
    (indicator.boxShadow !== 'none' && indicator.boxShadow !== '') ||
    indicator.ring.trim() !== '';
  expect(hasIndicator, `focused element must show a focus indicator: ${JSON.stringify(indicator)}`).toBe(true);
});

test('every surface is reachable by its own URL — navigation lives in the address bar', async ({
  page,
}) => {
  // CLAUDE.md's navigation rule: a screen change must be a real route, so Back is coherent and the
  // view is shareable. Client-only state for a navigational position is a bug.
  await page.goto('/solutions/quality/drift', { waitUntil: 'networkidle' });
  const drift = page.url();

  await page.goto('/insights/accounting', { waitUntil: 'networkidle' });
  await page.goBack({ waitUntil: 'networkidle' });

  expect(page.url(), 'Back must return to the previous surface, not leave the app').toBe(drift);
  await expect(page.locator('h1').first()).toBeVisible();
});

test('the quality surface states its empty case honestly', async ({ page }) => {
  await page.goto('/solutions/quality/drift', { waitUntil: 'networkidle' });

  // The regression this locks: a summary that reads "no decline detected" while every row underneath
  // says "not enough data" is a false all-clear. Whatever the data, the two must agree.
  const body = await page.locator('body').innerText();
  if (/not enough data/i.test(body)) {
    expect(
      /no decline detected/i.test(body),
      'a surface showing "not enough data" must not also claim "no decline detected"',
    ).toBe(false);
  }
});

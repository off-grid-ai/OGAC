// ─── Shared e2e harness for the evidence ledger ─────────────────────────────────────────────────────
//
// Every rule here was paid for by a wrong conclusion this session. See docs/EVIDENCE_LEDGER.md.
import { chromium } from 'playwright';

export const BASE = process.env.BASE || 'http://localhost:3000';
export const OUT = process.env.OUT || '/tmp/e2e';

/**
 * Type into a field the way a person does.
 *
 * NEVER use Playwright's fill() on a React-controlled input: it sets the DOM value without dispatching
 * what React needs, so component state stays empty, the component's own guard fires, and the test
 * reports a product defect that does not exist. That mistake produced a CONFIRMED-then-withdrawn gap
 * (G-195). pressSequentially sends real key events.
 */
export async function type(locator, text) {
  await locator.click();
  await locator.pressSequentially(text, { delay: 15 });
}

/** Sign in through the real credentials form and land on `route`. */
export async function signIn(route = '/overview', who = 'demo-bank@getoffgridai.co') {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signin?callbackUrl=${encodeURIComponent(route)}`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  // fill() is correct HERE: the signin form is uncontrolled and this is not the behaviour under test.
  await page.fill('input[name=username]', who);
  await page.fill('input[name=password]', process.env.DEMO_PASS || 'OffGridDemo2026!');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForTimeout(4000);
  // Navigate EXPLICITLY: the post-login redirect resolves to the canonical host and drops callbackUrl,
  // which once made me conclude a page had no buttons when I was simply on a different page.
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  return { browser, page };
}

/**
 * A ledger row's verdict. `pass` promotes the row to VERIFIED; anything else leaves it GAP.
 *
 * `detail` must quote the ARTIFACT — the text or attribute actually read — not a description of what
 * the script did. A verdict a reader cannot check is the proxy-for-the-goal substitution again.
 */
export function verdict(row, pass, detail) {
  const gate = pass ? 'VERIFIED' : 'GAP';
  console.log(`${gate}\t${row}\t${detail}`);
  return pass;
}

/** Wait for a condition, returning false on timeout instead of throwing — a timeout IS a verdict. */
export async function waitFor(fn, ms = 60000, step = 2000) {
  for (let waited = 0; waited < ms; waited += step) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

/**
 * Run a ledger row so that ANY failure becomes a verdict.
 *
 * Three times this session a row threw a TimeoutError instead of reporting — a mis-scoped locator, a
 * disabled control, a missing element — and each time the stack trace hid the finding. The rule "a
 * timeout IS a verdict" is only real if the harness enforces it, not if each script has to remember,
 * so every row is wrapped here rather than trusted to be careful.
 *
 * `fn` receives { page, browser } and returns true to pass. A throw is a GAP naming the failure.
 */
export async function row(name, route, fn, who) {
  let ctx;
  try {
    ctx = await signIn(route, who);
    const pass = await fn(ctx);
    return pass;
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0].slice(0, 120);
    await ctx?.page?.screenshot({ path: `${OUT}/${name}-threw.png`, fullPage: true }).catch(() => {});
    // A throw says the SCRIPT could not see the thing, which is not the same as the product lacking it.
    verdict(name, false, `script error (not a product verdict): ${msg}`);
    return false;
  } finally {
    await ctx?.browser?.close().catch(() => {});
  }
}

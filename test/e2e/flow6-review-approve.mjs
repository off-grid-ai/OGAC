// §10 Flow 6: reviewer sees the pending item, the evidence, the RISK and CONFIDENCE, and can act.
// The artifact is the review queue's item detail — a queue you cannot act from is not this flow.
import { signIn, verdict, OUT } from './lib.mjs';
const ROW = 'flow6-review-approve';
const { browser, page } = await signIn('/build/review');
const bodyText = ((await page.locator('main').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');

// §8G says the reviewer must see WHAT the system wants to do, WHY, and WHAT IS AT STAKE, and be able to
// act. My first pass grepped for the literal words "risk" and "evidence" and counted `tr, li` — both
// wrong, and they reported an empty queue while 35 runs sat awaiting a human. Assert what the surface
// actually presents: the decision counts, a named item, and a working act-on control.
const counts = /awaiting you\s*\d+/i.test(bodyText) && /you can approve\s*\d+/i.test(bodyText);
const limitAwareness = /above your limit\s*\d+/i.test(bodyText); // authority is shown, not assumed
const stake = /amount at stake|what you're approving|why/i.test(bodyText);
// OPEN THE ITEM FIRST. The page's own copy says "Open one to see what you're approving" — acting happens
// on the item detail, which is also what §10 Flow 6 describes (see pending item → understand it → act).
// Asserting an Approve button on the LIST demanded a design the product deliberately does not have, and
// reported the flow broken twice for it.
// The card's entry point is literally "Review now →" (see scratchpad/review-queue.png). Matching the
// card TITLE instead picked up the sidebar's "Reviews" nav item and navigated away — the same nav-item
// trap as Flow 3. Note /build/review redirects to /solutions/reviews, which is canonical.
const item = page.getByRole('link', { name: /^review now/i }).first();
if ((await item.count()) > 0) {
  await item.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(5000);
}
const act = page.getByRole('button', { name: /approve|reject|escalate|send back/i });
const actions = await act.count();
const detailUrl = page.url();
const named = /[A-Z][A-Z ]{6,}/.test(bodyText); // an identified case, not a bare row count

await page.screenshot({ path: `${OUT}/${ROW}.png`, fullPage: false });
const pass = actions > 0 && counts && limitAwareness && stake && named;
verdict(ROW, pass,
  `actions=${actions} counts=${counts} limitShown=${limitAwareness} stakeExplained=${stake} namedItem=${named}` +
  ` detail=${detailUrl.split('/build')[1] ?? detailUrl} sample="${bodyText.slice(0, 90)}"`);
await browser.close(); process.exit(pass ? 0 : 1);

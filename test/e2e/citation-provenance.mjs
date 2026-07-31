// ─── Ledger row: citation provenance ────────────────────────────────────────────────────────────────
//
// §8I "Cited" · §12 Observability "Data lineage" · §9 "Trust through visibility".
//
// THE PASS CONDITION IS THE ROW, NOT THE WORD. An earlier version of this check asserted
// getByText(/^Sources$/i), which matched 1 element on a page carrying no assistant answer at all — a
// locator that matches when the feature is absent can only produce false passes. This asserts the
// citation <li>: that it names a document, that the name is a followable link, and that any relevance
// shown is a real number rather than a placeholder 0%.
import { signIn, type, verdict, waitFor, OUT } from './lib.mjs';

const ROW = 'citation-provenance';
const { browser, page } = await signIn(
  // DEEP-LINK, no navigation guessing. This is the exact conversation from the founder's screenshot
  // (the ₹41,346.44 Training-quota answer) and its stored citation was repaired by
  // scripts/fix-seeded-citations.sql. Clicking through a sidebar added a failure mode that had nothing
  // to do with the claim under test.
  process.env.CONV_ROUTE || '/work/chat/conv_634a202ae6c5',
);

// TWO WAYS a citation row can exist, and both must be checked because they fail differently:
//   (a) an EXISTING answer whose stored citations render — this is what the seed fix repaired;
//   (b) a NEW answer produced by live retrieval.
// Opening a stored conversation is tried first: it needs no model call, so it isolates rendering +
// stored data from retrieval. My first version only did (b), which meant a 90s model timeout and a
// broken renderer produced the identical verdict.
const stored = page
  .getByRole('link', { name: /claim|policy|KYC|reimbursement|collection|Meera/i })
  .or(page.getByRole('button', { name: /claim|policy|KYC|reimbursement|collection|Meera/i }))
  .first();
if ((await stored.count()) > 0) {
  await stored.click({ timeout: 10000 }).catch(() => {}); // a missing entry point is not a throw
  await page.waitForTimeout(4000);
}

const composer = page.locator('textarea[aria-label="Message Off Grid AI"]');
if (!(await composer.count())) {
  verdict(ROW, false, 'no composer on /work/chat — cannot produce a grounded answer to inspect');
  await browser.close();
  process.exit(1);
}

// Only send a new message if the stored conversation showed no citation row — otherwise the stored
// artifact is the thing under test and a model call would just add latency and noise.
const already = await page.locator('li').filter({ has: page.locator('span', { hasText: /^\[\d+\]$/ }) }).count();
if (!already) {
  await type(composer, 'What is the reimbursement limit for Training? Cite the policy.');
  await composer.press('Enter');
}

// The artifact: an <li> containing a [n] marker.
const row = page.locator('li').filter({ has: page.locator('span', { hasText: /^\[\d+\]$/ }) }).first();
const appeared = await waitFor(async () => (await row.count()) > 0, 90000);

if (!appeared) {
  verdict(ROW, false, 'no citation row rendered within 90s — the answer carried no provenance');
  await page.screenshot({ path: `${OUT}/${ROW}-fail.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
}

const text = (await row.innerText()).replace(/\s+/g, ' ').trim();
const link = row.locator('a');
const linked = (await link.count()) > 0;
const href = linked ? await link.first().getAttribute('href') : null;

// Three independent failures, each reported by what was READ.
const named = !/unnamed document/i.test(text);
const followable = linked && !!href && /^\/(data\/knowledge|work\/projects)\//.test(href);
const honestScore = !/\b0%\b/.test(text); // a cited source is never 0% relevant

await row.screenshot({ path: `${OUT}/${ROW}.png` }).catch(() => {});

const pass = named && followable && honestScore;
verdict(
  ROW,
  pass,
  `row="${text}" href=${href ?? 'none'} | named=${named} followable=${followable} honestScore=${honestScore}`,
);
await browser.close();
process.exit(pass ? 0 : 1);

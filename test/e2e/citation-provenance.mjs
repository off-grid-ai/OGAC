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
// NAVIGATE BY CLICKING, never by deep link. `/work/chat/<id>` silently loads a DIFFERENT conversation
// (logged separately as a real defect), so a deep-linked run asserts against the wrong page — it produced
// two false "no citation row" verdicts before I noticed the URL bar disagreed with my intent.
const { browser, page } = await signIn('/work/chat');
await page.waitForTimeout(3500);

const target = process.env.CHAT_TITLE || 'KYC re-verification questions';
const entry = page.getByText(new RegExp(target, 'i')).first();
if (!(await entry.count())) {
  verdict(ROW, false, `no chat titled "${target}" visible to this identity — chats are per-user scoped`);
  await browser.close();
  process.exit(1);
}
await entry.click();
await page.waitForTimeout(7000);

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

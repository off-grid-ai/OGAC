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
const { browser, page } = await signIn('/work/chat');

// A grounded answer needs a knowledge-bearing conversation. Prefer a project chat if one is offered.
const project = page.getByText(/Reimbursement queries|KYC re-verification/i).first();
if (await project.count()) {
  await project.click();
  await page.waitForTimeout(3000);
}

const composer = page.locator('textarea[aria-label="Message Off Grid AI"]');
if (!(await composer.count())) {
  verdict(ROW, false, 'no composer on /work/chat — cannot produce a grounded answer to inspect');
  await browser.close();
  process.exit(1);
}

await type(composer, 'What is the reimbursement limit for Training? Cite the policy.');
await composer.press('Enter');

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

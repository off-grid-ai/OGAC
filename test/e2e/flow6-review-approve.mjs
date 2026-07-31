// §10 Flow 6: reviewer sees the pending item, the evidence, the RISK and CONFIDENCE, and can act.
// The artifact is the review queue's item detail — a queue you cannot act from is not this flow.
import { signIn, verdict, OUT } from './lib.mjs';
const ROW = 'flow6-review-approve';
const { browser, page } = await signIn('/build/review');
const bodyText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
// §8G names what the reviewer must see. Absence of ALL of it means the queue is a list, not a review.
const hasRisk = /\brisk\b/i.test(bodyText);
const hasEvidence = /evidence|source|citation/i.test(bodyText);
const act = page.getByRole('button', { name: /^(approve|reject|escalate)$/i });
const actions = await act.count();
const items = await page.locator('a[href*="/build/review/"], tr, li').count();
await page.screenshot({ path: `${OUT}/${ROW}.png`, fullPage: false });
const pass = actions > 0 && hasRisk && hasEvidence;
verdict(ROW, pass, `items=${items} actionButtons=${actions} risk=${hasRisk} evidence=${hasEvidence}`);
await browser.close(); process.exit(pass ? 0 : 1);

// §12 Compliance: "Immutable or append-only audit trail". The artifact is an audit row that ATTRIBUTES
// an action — actor, action and outcome together. A page of counts proves nothing about attribution.
import { signIn, verdict, OUT } from './lib.mjs';
const ROW = 's12-audit-trail';
const { browser, page } = await signIn('/governance/evidence/audit');
await page.waitForTimeout(3000);
const t = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
const rows = await page.locator('tbody tr').count();
// A failure must never present as emptiness — an empty table with no explanation is itself a GAP.
const explainsEmpty = /no events|nothing recorded|could not load|failed to/i.test(t);
const attributed = /@|\bsystem\b|\bactor\b/i.test(t) && /\b(ok|blocked|redacted|denied|error)\b/i.test(t);
await page.screenshot({ path: `${OUT}/${ROW}.png` }).catch(() => {});
const pass = rows > 0 && attributed;
verdict(ROW, pass, `rows=${rows} attributed=${attributed} explainsEmptyState=${explainsEmpty} sample="${t.slice(0, 160)}"`);
await browser.close(); process.exit(pass ? 0 : 1);

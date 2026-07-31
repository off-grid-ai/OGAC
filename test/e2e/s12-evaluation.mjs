// §12 Evaluation: "Golden datasets", "Quality thresholds", "Release gates". The artifact is an eval
// definition that shows a SCORE and a THRESHOLD — a list of eval names proves nothing was measured.
import { signIn, verdict, OUT } from './lib.mjs';
const ROW = 's12-evaluation';
const { browser, page } = await signIn('/build/evals');
await page.waitForTimeout(3000);
const t = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
const defs = await page.locator('tbody tr, a[href*="/build/evals/"]').count();
const hasScore = /\d+(\.\d+)?%|\b0\.\d{2}\b/.test(t);
const hasThreshold = /threshold|gate|pass(ing)? mark|minimum/i.test(t);
const canRun = await page.getByRole('button', { name: /run|execute/i }).count();
await page.screenshot({ path: `${OUT}/${ROW}.png` }).catch(() => {});
const pass = defs > 0 && hasScore && hasThreshold;
verdict(ROW, pass, `definitions=${defs} score=${hasScore} threshold=${hasThreshold} runControl=${canRun}`);
await browser.close(); process.exit(pass ? 0 : 1);

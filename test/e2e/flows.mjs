// ─── §10 flows whose proof is a reachable, actionable surface ───────────────────────────────────────
//
// Same engine as s12-surfaces.mjs. A flow row passes only when the surface shows the STATE the flow is
// about and offers the control that advances it — a page that describes the flow without letting anyone
// perform it is WIRED, not VERIFIED.
import { signIn, verdict, OUT } from './lib.mjs';

const ROWS = [
  { row: 'flow1-enterprise-setup', route: '/governance/access',
    must: [/\b(identity|sso|oidc|saml|provider|user)\b/i], act: /add|invite|connect|configure/i },
  { row: 'flow2-connect-data-source', route: '/data/integrations',
    must: [/\b(connector|source|integration)\b/i, /\b(connected|test|status|healthy|configure)\b/i],
    act: /connect|add|new|create|test/i },
  { row: 'flow4-build-from-template', route: '/solutions/library',
    must: [/\b(template|library|solution|blueprint|sop)\b/i], act: /use|clone|start|create|deploy/i },
  { row: 'flow5-use-an-application', route: '/solutions/apps',
    must: [/\b(app|application)\b/i], act: /open|run|use|launch/i },
  { row: 'flow7-investigate-failure', route: '/build/apps/runs',
    must: [/\b(run|status)\b/i, /\b(done|error|failed|running|awaiting)\b/i], act: /re-?run|retry|open|view/i },
  { row: 's12-deployment', route: '/operations',
    must: [/\b(service|deployment|host|node|version)\b/i, /\b(healthy|running|degraded|ok|ready)\b/i],
    act: /restart|deploy|reload|probe|refresh/i },
];

let gaps = 0;
for (const spec of ROWS) {
  let page, browser;
  try {
    ({ browser, page } = await signIn(spec.route));
    await page.waitForTimeout(2500);
    const text = ((await page.locator('main').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const rows = await page.locator('tbody tr, [role=row], li, a[href*="/"]').count();
    const missing = spec.must.filter((re) => !re.test(text)).map(String);
    const acts = await page.getByRole('button', { name: spec.act }).count()
      + await page.getByRole('link', { name: spec.act }).count();
    const failedRead = /failed to|could not load|error loading/i.test(text) && rows === 0;
    await page.screenshot({ path: `${OUT}/${spec.row}.png` }).catch(() => {});
    const pass = missing.length === 0 && acts > 0 && !failedRead;
    if (!pass) gaps++;
    verdict(spec.row, pass, `${spec.route} rows=${rows} acts=${acts}` +
      (missing.length ? ` MISSING=${missing.join(',')}` : '') + ` sample="${text.slice(0, 110)}"`);
  } catch (e) {
    gaps++; verdict(spec.row, false, `${spec.route} threw: ${String(e.message).slice(0, 80)}`);
  } finally { await browser?.close(); }
}
process.exit(gaps ? 1 : 0);

// ─── §12 table-stakes subsections whose proof is a rendered, MEASURED artifact ─────────────────────
//
// One assertion engine, many ledger rows — the alternative is fifteen near-identical scripts that drift.
// Each row declares the route and what must be PRESENT for the claim to be evidenced. `must` patterns
// are things that cannot appear unless the feature produced them (a live value, a state, an identity);
// `act` is a control that makes the surface manageable rather than a read-only dashboard.
//
// A row also fails when the page reports its own failure as emptiness — `/failed to|could not load/`
// with zero rows is a GAP even if the shell renders.
import { signIn, verdict, OUT } from './lib.mjs';

const ROWS = [
  { row: 's12-identity-access', route: '/governance/access',
    must: [/\brole|rbac|abac\b/i, /\b(admin|editor|viewer|member)\b/i], act: /add|invite|create|assign/i },
  { row: 's12-security-egress', route: '/governance/egress',
    must: [/allow|deny|block/i, /\b(domain|host|destination|endpoint)\b/i], act: /add|create|save|allow/i },
  { row: 's12-security-secrets', route: '/governance/secrets/overview',
    must: [/\b(mount|kv|lease|secret)\b/i, /\b(sealed|unsealed|active|healthy)\b/i], act: /create|write|rotate|new/i },
  { row: 's12-observability-traces', route: '/insights/ai',
    must: [/\b(trace|span|latency|tokens?)\b/i, /\d/], act: null },
  { row: 's12-model-operations', route: '/runtime',
    must: [/\bmodel|gateway|provider\b/i, /\b(healthy|available|degraded|offline|ready)\b/i], act: null },
  { row: 's12-agent-operations', route: '/build/agent-runs',
    must: [/\b(run|step|status)\b/i, /\b(done|error|running|awaiting|queued)\b/i], act: /cancel|re-?run|retry/i },
  { row: 's12-data-connectors', route: '/data',
    must: [/\b(connector|source|schema|domain)\b/i], act: /connect|add|new|create/i },
  { row: 's12-reliability-health', route: '/operations',
    must: [/\b(health|uptime|status|service)\b/i, /\b(healthy|degraded|down|ok)\b/i], act: null },
  { row: 's12-policy-decisions', route: '/governance/policies/decision-logs',
    must: [/allow|deny|blocked/i, /\b(policy|rule|bundle)\b/i], act: null },
  { row: 's12-developer-experience', route: '/docs',
    must: [/\b(api|endpoint|curl|token)\b/i], act: null },
];

let gaps = 0;
for (const spec of ROWS) {
  let page, browser;
  try {
    ({ browser, page } = await signIn(spec.route));
    await page.waitForTimeout(2500);
    const main = page.locator('main');
    const text = ((await main.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const rows = await page.locator('tbody tr, [role=row], li').count();
    const missing = spec.must.filter((re) => !re.test(text)).map((re) => String(re));
    const acts = spec.act ? await page.getByRole('button', { name: spec.act }).count() : 1;
    // A failure that presents as emptiness is a GAP, not a pass.
    const failedRead = /failed to|could not load|error loading/i.test(text) && rows === 0;
    await page.screenshot({ path: `${OUT}/${spec.row}.png` }).catch(() => {});
    const pass = missing.length === 0 && acts > 0 && !failedRead;
    if (!pass) gaps++;
    verdict(spec.row, pass,
      `${spec.route} rows=${rows} acts=${acts} failedRead=${failedRead}` +
      (missing.length ? ` MISSING=${missing.join(',')}` : '') + ` sample="${text.slice(0, 110)}"`);
  } catch (e) {
    gaps++;
    verdict(spec.row, false, `${spec.route} threw: ${String(e.message).slice(0, 80)}`);
  } finally {
    await browser?.close();
  }
}
process.exit(gaps ? 1 : 0);

import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { pushRulesToOpa } from '@/lib/policy-rules';
import { currentOrgId } from '@/lib/tenancy';

// Action: compile the org's enabled policy rules into an OPA data document, PUT it to OPA, then
// reload/reevaluate (re-probe engine health). Returns the compiled bundle + push outcome so the UI
// can report what shipped. Dry-run (no OPA configured) still returns the compiled document.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const result = await pushRulesToOpa(org);
  // Audit the push. A dry run (no OPA) or a failed PUT is a real failure to ship policy → 'error';
  // a successful PUT is 'ok'. The resource records how many entries the compiled bundle carried.
  auditFromSession(gate, org, {
    action: 'policy.change',
    resource: `opa:${result.document.entries.length}-rules`,
    outcome: result.pushed ? 'ok' : 'error',
  });
  return NextResponse.json(result);
}

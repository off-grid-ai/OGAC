import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { pushRulesToOpa } from '@/lib/policy-rules';
import { currentOrgId } from '@/lib/tenancy';

// Action: compile the org's enabled policy rules into an OPA data document, PUT it to OPA, then
// reload/reevaluate (re-probe engine health). Returns the compiled bundle + push outcome so the UI
// can report what shipped. Dry-run (no OPA configured) still returns the compiled document.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await pushRulesToOpa(await currentOrgId()));
}

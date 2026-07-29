import { NextResponse } from 'next/server';
import { getPii } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { readGuardrailsView } from '@/lib/guardrails-view';
import { currentOrgId } from '@/lib/tenancy';

// Guardrails / PII surface read-back. GET returns the display model (active engine + reachability +
// entity types). POST scans caller-provided text and returns the same model with a `demo` block — no
// persistence, no side effects.
//
// THE SCAN GOES THROUGH THE REAL ENGINE (G-F2). It used to call `demoScan`, a private two-pattern
// (email + phone) regex living in guardrails-view — a THIRD PII implementation alongside the regex
// floor and the actual engine. So this screen ran the weakest detector while the response advertised
// `engine: "llm-guard"`: an operator typing a PAN saw it pass, and concluded the platform's own
// "Mask PAN in every output" policy was working when nothing had screened it. Now the same adapter
// the governed run uses answers here, so what an operator tests IS what enforcement does.
//
// `orgId` is threaded so an operator's disabled scanners (per-tenant config) apply to the check too —
// otherwise the screen would report a verdict the tenant's own configuration would not produce.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await readGuardrailsView());
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text : '';
  const orgId = await currentOrgId();
  const result = await getPii().scan(text, orgId);
  return NextResponse.json(await readGuardrailsView(result, text));
}

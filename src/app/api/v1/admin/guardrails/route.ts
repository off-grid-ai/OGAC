import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { demoScan, readGuardrailsView } from '@/lib/guardrails-view';

// Guardrails / PII surface read-back. GET returns the display model (active engine + reachability +
// entity types). POST runs a read-only demo scan on caller-provided text through the regex floor and
// returns the same model with a `demo` block — no persistence, no side effects.

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
  const result = demoScan(text);
  return NextResponse.json(await readGuardrailsView(result, text));
}

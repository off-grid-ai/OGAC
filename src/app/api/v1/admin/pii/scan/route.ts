import { NextResponse } from 'next/server';
import { getPii } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';

// Standalone PII scan: detect (and redact) sensitive entities in arbitrary text through the
// guardrails port (first-party detectors by default, Presidio when OFFGRID_ADAPTER_GUARDRAILS=presidio).
// POST { text } → { hits, entities, redacted, engine }.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { text?: unknown } | null;
  if (!b || typeof b.text !== 'string' || !b.text.trim()) {
    return NextResponse.json({ error: 'text (string) required' }, { status: 400 });
  }
  return NextResponse.json(await getPii().scan(b.text));
}

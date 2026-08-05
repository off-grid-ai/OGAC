import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateOwner } from '@/lib/data-ownership-policy';
import { readOwnershipSummary, setNamespaceOwner } from '@/lib/adapters/marquez-metadata';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Who owns each data area in the lineage catalogue. GET reports it (and says when nobody does); PUT
// assigns an owner. A failed read is a 502, never an empty list — an unreachable catalogue must not read
// as a catalogue with nothing in it.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const out = await readOwnershipSummary();
  return out.ok
    ? NextResponse.json(out.result)
    : NextResponse.json({ error: out.reason }, { status: 502 });
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as { namespace?: string; owner?: string; description?: string } | null;
  const namespace = body?.namespace?.trim();
  if (!namespace) return NextResponse.json({ error: 'namespace is required' }, { status: 400 });

  // Validated BEFORE the write: "anonymous" is exactly how every namespace ended up unowned, and
  // accepting it here would let someone tick the box without answering the question.
  const owner = validateOwner(body?.owner);
  if (!owner.ok) return NextResponse.json({ error: owner.sentence, problem: owner.problem }, { status: 400 });

  const out = await setNamespaceOwner(namespace, owner.owner, body?.description);
  if (!out.ok) return NextResponse.json({ error: out.reason }, { status: 502 });
  auditFromSession(gate, await currentOrgId(), {
    action: 'catalogue.owner.set',
    resource: `namespace:${namespace}`,
    outcome: 'ok',
  });
  return NextResponse.json(out.result);
}

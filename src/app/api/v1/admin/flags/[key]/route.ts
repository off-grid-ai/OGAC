import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { managedDeleteFlag, managedGetFlag, managedSetDescription } from '@/lib/flags-manager';

// Flag detail — enabled state + variants + gradual-rollout % for the active environment. When
// Unleash drives management this comes from the Admin API; otherwise from the first-party store
// (which has no variants/rollout, so those come back empty/null).
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  const detail = await managedGetFlag(decodeURIComponent(key));
  if (!detail) return NextResponse.json({ error: 'unknown flag' }, { status: 404 });
  return NextResponse.json(detail);
}

// Edit the flag description.
export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  const b = (await req.json().catch(() => null)) as { description?: unknown } | null;
  if (!b || typeof b.description !== 'string') {
    return NextResponse.json({ error: 'description (string) required' }, { status: 400 });
  }
  const backend = await managedSetDescription(decodeURIComponent(key), b.description.slice(0, 300));
  auditFromSession(gate, await currentOrgId(), {
    action: 'flag.toggle',
    resource: `flag:${decodeURIComponent(key)}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, backend });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  const ok = await managedDeleteFlag(decodeURIComponent(key));
  if (!ok) return NextResponse.json({ error: 'unknown flag' }, { status: 404 });
  auditFromSession(gate, await currentOrgId(), {
    action: 'flag.toggle',
    resource: `flag:${decodeURIComponent(key)}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}

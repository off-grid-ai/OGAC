import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteDomain, verifyDomain } from '@/lib/resend-domains';
import {
  deleteResendDomainRow,
  getResendDomain,
  upsertResendDomain,
} from '@/lib/resend-domains-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → the stored domain (status + records) for the console detail. POST → "check verification": ask
// Resend to re-read the DNS, refresh the stored status/records, and return them. DELETE → remove the
// registration both at Resend and locally.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const { id } = await params;
  const domain = await getResendDomain(id, orgId);
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(domain);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const { id } = await params;
  const owned = await getResendDomain(id, orgId);
  if (!owned) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const result = await verifyDomain(id);
  if (!result.ok) {
    const status = !result.configured ? 503 : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }
  await upsertResendDomain(orgId, result.data!);
  auditFromSession(gate, orgId, {
    action: 'messaging.resend.domain.verify',
    resource: `resend-domain:${id} ${result.data!.domain} → ${result.data!.status}`,
    outcome: 'ok',
  });
  return NextResponse.json(result.data);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const { id } = await params;
  const owned = await getResendDomain(id, orgId);
  if (!owned) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await deleteDomain(id); // best-effort remove at Resend
  const removed = await deleteResendDomainRow(id, orgId);
  auditFromSession(gate, orgId, {
    action: 'messaging.resend.domain.delete',
    resource: `resend-domain:${id} ${owned.domain}`,
    outcome: removed ? 'ok' : 'error',
  });
  return NextResponse.json({ ok: removed });
}

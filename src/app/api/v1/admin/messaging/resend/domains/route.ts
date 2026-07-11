import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { registerDomain } from '@/lib/resend-domains';
import { listResendDomains, upsertResendDomain } from '@/lib/resend-domains-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Admin CRUD for self-serve SENDING-DOMAIN verification. POST registers the org's domain with Resend
// and RETURNS the DNS records the customer must add to THEIR OWN DNS (SPF/DKIM/DMARC/return-path). We
// never touch their DNS. GET lists the org's registered domains + stored records/status.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const domains = await listResendDomains(orgId);
  return NextResponse.json({ object: 'list', data: domains });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => ({}))) as { domain?: string; region?: string };
  const domain = (body.domain ?? '').trim();
  if (!domain) return NextResponse.json({ error: 'domain is required' }, { status: 400 });

  const result = await registerDomain(domain, body.region?.trim() || undefined);
  if (!result.ok) {
    const status = !result.configured ? 503 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  // Persist ONLY {domain, status, records} so the console can list + re-check without re-registering.
  await upsertResendDomain(orgId, result.data!);
  auditFromSession(gate, orgId, {
    action: 'messaging.resend.domain.register',
    resource: `resend-domain:${result.data!.id} ${result.data!.domain}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ...result.data, note: result.reason }, { status: 201 });
}

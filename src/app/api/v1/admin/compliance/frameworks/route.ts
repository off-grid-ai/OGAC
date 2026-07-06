import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { adoptFramework, frameworkOverview, unadoptFramework } from '@/lib/compliance-adoption';
import { isKnownFramework } from '@/lib/compliance-catalog';
import { currentOrgId } from '@/lib/tenancy';

// Compliance framework adoption. GET returns per-framework progress + adopted flag. POST adopts a
// framework (seeds its controls as tracked, status 'new'); DELETE un-adopts (drops its tracking).
// Thin: admin-gated, delegate to the lib, audit the change.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await frameworkOverview(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as { frameworkId?: unknown } | null;
  const frameworkId = typeof body?.frameworkId === 'string' ? body.frameworkId : '';
  if (!isKnownFramework(frameworkId)) {
    return NextResponse.json({ error: 'unknown framework' }, { status: 400 });
  }
  const orgId = await currentOrgId();
  const seeded = await adoptFramework(frameworkId, orgId);
  auditFromSession(gate, orgId, {
    action: 'compliance.adopt',
    resource: `framework:${frameworkId}`,
    outcome: 'ok',
  });
  return NextResponse.json({ adopted: frameworkId, seeded }, { status: 201 });
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const frameworkId = url.searchParams.get('frameworkId') ?? '';
  if (!isKnownFramework(frameworkId)) {
    return NextResponse.json({ error: 'unknown framework' }, { status: 400 });
  }
  const orgId = await currentOrgId();
  const removed = await unadoptFramework(frameworkId, orgId);
  auditFromSession(gate, orgId, {
    action: 'compliance.unadopt',
    resource: `framework:${frameworkId}`,
    outcome: 'ok',
  });
  return NextResponse.json({ unadopted: frameworkId, removed });
}

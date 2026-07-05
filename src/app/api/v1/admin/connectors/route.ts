import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { createConnector, listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

const AUTHS = ['none', 'api-key', 'oauth'];

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listConnectors(await currentOrgId()) });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = body?.name as string | undefined;
  const type = body?.type as string | undefined;
  if (!name || !type) {
    return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
  }
  const auth = (body?.auth as string | undefined) ?? 'none';
  if (!AUTHS.includes(auth)) {
    return NextResponse.json({ error: 'auth must be none | api-key | oauth' }, { status: 400 });
  }
  const orgId = await currentOrgId();
  const created = await createConnector({
    name,
    type,
    endpoint: (body?.endpoint as string | undefined) ?? '',
    auth,
    description: (body?.description as string | undefined) ?? '',
    custom: true,
    orgId,
  });
  auditFromSession(gate, orgId, {
    action: 'connector.create',
    resource: `connector:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}

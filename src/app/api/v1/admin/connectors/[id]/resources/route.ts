import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getConnector } from '@/lib/connector-detail';
import { listResources } from '@/lib/connector-exec';
import { currentOrgId } from '@/lib/tenancy';

// Resource browse. Lists the tables/objects on a connector (information_schema for SQL, the base
// URL's top-level collection keys for REST) so a user picks a resource to bind instead of hand-typing
// a raw string. READ-only, admin-gated. Returns { resources: [] } with `available: false` when the
// source is unreachable / not a live-query type, so the UI degrades to manual entry honestly.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const conn = await getConnector(id, orgId);
  if (!conn) return NextResponse.json({ error: 'unknown connector' }, { status: 404 });

  const resources = await listResources({
    id: conn.id,
    orgId,
    type: conn.type,
    endpoint: conn.endpoint,
  });
  if (resources === null) {
    return NextResponse.json({ available: false, resources: [] });
  }
  return NextResponse.json({ available: true, resources });
}

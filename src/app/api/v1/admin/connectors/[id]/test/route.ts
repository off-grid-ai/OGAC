import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getConnector } from '@/lib/connector-detail';
import { testConnection } from '@/lib/connector-exec';

// Test-connection probe. Resolves the connector (org-scoped), injects its vaulted credential at
// query time, and runs the lightest possible check (SELECT 1 for SQL, a GET of the base URL for
// REST). Returns an honest pass/fail the UI shows inline. READ-only, admin-gated. 200 either way —
// a failed CONNECTION is not a failed REQUEST; the body carries { ok, message }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const conn = await getConnector(id, orgId);
  if (!conn) return NextResponse.json({ error: 'unknown connector' }, { status: 404 });

  const result = await testConnection({ id: conn.id, type: conn.type, endpoint: conn.endpoint });
  auditFromSession(gate, orgId, {
    action: 'connector.test',
    resource: `connector:${id}`,
    outcome: result.ok ? 'ok' : 'fail',
  });
  return NextResponse.json(result);
}

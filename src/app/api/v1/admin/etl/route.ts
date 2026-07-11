import { NextResponse } from 'next/server';
import { airbyteEtl } from '@/lib/adapters/airbyte';
import { requireAdmin } from '@/lib/authz';

// ETL overview — { healthy, workspaces, connections }. Best-effort: every field degrades to a
// safe empty when Airbyte is unreachable or not yet set up (fresh install with no workspace), so
// the surface renders an honest empty state, never a 500. Admin-gated like the connectors routes.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const [healthy, workspaces, connections] = await Promise.all([
    airbyteEtl.health(),
    airbyteEtl.listWorkspaces(),
    airbyteEtl.listConnections(),
  ]);

  return NextResponse.json({ healthy, workspaces, connections });
}

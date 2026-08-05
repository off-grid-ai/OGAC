import { NextResponse } from 'next/server';
import { airbyteEtl } from '@/lib/adapters/airbyte';
import { requireAdmin } from '@/lib/authz';
import { currentEtlConnections } from '@/lib/etl-scope';

// ETL overview — { healthy, workspaces, connections }. Best-effort: every field degrades to a
// safe empty when Airbyte is unreachable or not yet set up (fresh install with no workspace), so
// the surface renders an honest empty state, never a 500. Admin-gated like the connectors routes —
// a viewer passes on GET (the read-everything/write-nothing rule), so `connections` MUST be
// org-scoped here: this route is what confirmed the cross-tenant leak live (byte-identical response
// diffed between the two demo sessions) — see src/lib/etl-tenancy.ts for the ownership rule.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const [healthy, workspaces, connections] = await Promise.all([
    airbyteEtl.health(),
    airbyteEtl.listWorkspaces(),
    currentEtlConnections(),
  ]);

  return NextResponse.json({ healthy, workspaces, connections });
}

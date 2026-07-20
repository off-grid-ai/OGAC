import { NextResponse } from 'next/server';
import { agentActivity, listAllAgents } from '@/lib/agents';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

// The catalog (built-ins + user-authored) + derived fleet activity. Agents are adoptable
// standalone; the `planes` each declares lets a tenant see what it needs provisioned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({
    object: 'list',
    data: await listAllAgents(orgId),
    activity: await agentActivity(orgId),
  });
}

// Standalone agent creation is retired. AppSpec is the canonical authoring entity; a one-step app
// is an agent. GET remains for backwards-compatible runtime inventory reads.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(
    {
      error: 'Standalone agent authoring has moved to Apps.',
      canonical: '/api/v1/admin/apps',
      builder: '/build/studio/new',
    },
    { status: 410 },
  );
}

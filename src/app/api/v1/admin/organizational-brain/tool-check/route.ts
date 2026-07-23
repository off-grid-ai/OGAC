import { NextResponse } from 'next/server';
import { maybeRunComposableTool } from '@/lib/adapters/tool-primitives';
import { requireAdmin } from '@/lib/authz';
import { toolRef } from '@/lib/tool-primitives';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Governed self-test for the organizational-brain agent tool (`prim:org_brain_search`). It invokes
// the EXACT composable-tool dispatch an agent/App uses at runtime, with the CALLER's real identity
// (org from the tenant host, role from the session) — so the org-brain RBAC (resolveBrainAuthorization
// + requireBrainCapability) is enforced identically to a real agent run. An operator/verifier uses
// it to confirm the tool retrieves (authorized) or is refused (RBAC / tenant isolation) without
// depending on an autonomous LLM choosing to call it. Read-only; never mutates.
export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => ({}))) as { query?: unknown };
  const query =
    typeof body.query === 'string' && body.query.trim() ? body.query.trim() : 'organizational brain';
  const orgId = await currentOrgId();
  const result = await maybeRunComposableTool(
    toolRef('org_brain_search'),
    { orgId, actor: gate.user.email ?? 'service@offgrid.local', actorRole: gate.user.role },
    undefined,
    query,
  );
  return NextResponse.json({ tenant: orgId, actorRole: gate.user.role, tool: 'prim:org_brain_search', result });
}

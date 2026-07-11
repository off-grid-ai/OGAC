import { NextResponse } from 'next/server';
import { compileAppSpec } from '@/lib/app-compile';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST { description } → the NL→AppSpec compiler (Builder Epic 2C, task #106).
//
// Thin admin-gated shell: it authenticates, resolves the org, and delegates ALL logic to
// `compileAppSpec` (pure decomposition + honest data-domain binding + the gateway/heuristic paths).
// It DOES NOT persist — the builder saves the spec later via apps-store. This route only compiles
// the plain-language description into a runnable, governed AppSpec skeleton + a list of honest gaps
// (data phrases with no declared source, unknown step kinds, validation issues) so the UI can surface
// them for the operator to fix, never a fabricated connector.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => ({}))) as { description?: unknown };
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const ownerId = gate.user.email ?? 'service@offgrid.local';

  const { spec, gaps } = await compileAppSpec(description, { orgId, ownerId });
  return NextResponse.json({ object: 'app_compile', spec, gaps });
}

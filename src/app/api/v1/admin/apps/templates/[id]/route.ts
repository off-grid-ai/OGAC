import { NextResponse } from 'next/server';
import { getApp, getTemplate } from '@/lib/apps-store';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── GET /api/v1/admin/apps/templates/[id] — one template's detail ─────────────────────────────────
// Returns the template view (title, summary, step count, declared var schema, visibility) honouring
// the same org/public visibility rule as the library list. When the viewer owns the template's org,
// the full source AppSpec (the workflow graph) is attached so the detail page can render the steps.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const template = await getTemplate(id, orgId);
  if (!template) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // The full graph is only readable to the owning org; a cross-org adopter sees metadata + vars only
  // (the workflow is instantiated on adoption, not previewed step-by-step across tenant boundaries).
  const spec = template.orgId === orgId ? await getApp(id, orgId) : null;
  return NextResponse.json({ template, spec });
}

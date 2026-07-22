import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteModelDeployment } from '@/lib/litellm';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// DELETE a DB-managed model deployment from the routing pool by its LiteLLM model id (/model/delete).
// Config-file base models have no removable id here — the UI only offers delete on db-managed rows.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'model id required' }, { status: 400 });
  try {
    await deleteModelDeployment(id);
    const org = await currentOrgId();
    auditFromSession(gate, org, {
      action: 'gateway.model.delete',
      resource: `model:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

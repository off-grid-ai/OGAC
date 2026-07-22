import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { addModelDeployment, listModelDeployments } from '@/lib/litellm';
import { buildAddModelBody, shapeProviderPool, type ProviderPoolInput } from '@/lib/litellm-provider-pool';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ── Provider-pool management (routing → models) over LiteLLM's DB-backed model API ─────────────────
// GET lists the routing pool (config-file base + DB-managed deployments), shaped for display — never
// returns raw API keys. POST adds a fleet/cloud deployment as a validated /model/new transaction.
// Thin handler: the decision (what body to POST) is the pure buildAddModelBody; the I/O is litellm.ts.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const raw = await listModelDeployments();
  return NextResponse.json({ object: 'list', data: shapeProviderPool(raw) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as ProviderPoolInput | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const built = buildAddModelBody(body);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
  try {
    const res = (await addModelDeployment(built.body)) as { model_id?: string };
    const org = await currentOrgId();
    auditFromSession(gate, org, {
      action: 'gateway.model.add',
      resource: `model:${String((built.body as { model_name?: string }).model_name ?? '?')}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, modelId: res?.model_id ?? null }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

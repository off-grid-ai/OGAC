import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { getEdgeIntent, saveEdgeIntent } from '@/lib/store';
import { setWafEnabled } from '@/lib/edge-intent';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Read the persisted edge-WAF intent (desired state). Admin-gated — it's an operator control plane.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await getEdgeIntent());
}

// Turn the WAF on/off. Persists the INTENT — the console can't reload Caddy safely, so this applies
// on the next edge reload (the UI shows "pending" until it's live). Admin-gated + audited.
export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: { enabled?: unknown };
  try {
    body = (await req.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  const current = await getEdgeIntent();
  const next = setWafEnabled(current, body.enabled);
  const saved = await saveEdgeIntent(next);

  auditFromSession(gate, await currentOrgId(), {
    action: body.enabled ? 'edge.waf.enable' : 'edge.waf.disable',
    resource: 'edge:waf',
    outcome: 'ok',
  });
  return NextResponse.json(saved, { status: 200 });
}

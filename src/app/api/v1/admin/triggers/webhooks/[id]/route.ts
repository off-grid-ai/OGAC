import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import {
  deleteWebhookTrigger,
  rotateWebhookSecret,
  setWebhookTriggerEnabled,
} from '@/lib/webhook-triggers';

export const dynamic = 'force-dynamic';

// PATCH { action: 'enable'|'disable'|'rotate' } — toggle a trigger or rotate its signing secret
// (rotate returns the new secret ONCE). DELETE removes the trigger + purges its vault secret. All
// org-scoped: the {id} must belong to the caller's tenant.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === 'rotate') {
    const secret = await rotateWebhookSecret(id, orgId);
    if (!secret) return NextResponse.json({ error: 'not found' }, { status: 404 });
    auditFromSession(gate, orgId, { action: 'trigger.webhook.rotate', resource: `webhook:${id}`, outcome: 'ok' });
    return NextResponse.json({ id, secret });
  }
  if (body.action === 'enable' || body.action === 'disable') {
    const ok = await setWebhookTriggerEnabled(id, orgId, body.action === 'enable');
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    auditFromSession(gate, orgId, {
      action: `trigger.webhook.${body.action}`,
      resource: `webhook:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ id, enabled: body.action === 'enable' });
  }
  return NextResponse.json({ error: "action must be enable|disable|rotate" }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const ok = await deleteWebhookTrigger(id, orgId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, orgId, { action: 'trigger.webhook.delete', resource: `webhook:${id}`, outcome: 'ok' });
  return NextResponse.json({ id, deleted: true });
}

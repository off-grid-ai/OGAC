import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { isWebhookTargetKind } from '@/lib/webhook-trigger-policy';
import { createWebhookTrigger, listWebhookTriggers } from '@/lib/webhook-triggers';

export const dynamic = 'force-dynamic';

// Admin CRUD for webhook triggers (the builder provisions one per app/agent that wants an external
// inbound trigger). The public firing route is /api/v1/triggers/[token]; here we mint/list them.
// The public base is OFFGRID_WEBHOOK_BASE_URL (e.g. https://hooks.getoffgridai.co) when set, else the
// path is returned relative so the caller can prefix the console host.
function publicUrl(token: string): string {
  const base = (process.env.OFFGRID_WEBHOOK_BASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/api/v1/triggers/${token}`;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const triggers = await listWebhookTriggers(orgId);
  return NextResponse.json({
    object: 'list',
    data: triggers.map((t) => ({ ...t, url: publicUrl(t.token) })),
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => ({}))) as {
    targetKind?: string;
    targetId?: string;
    label?: string;
  };
  if (!isWebhookTargetKind(body.targetKind) || !body.targetId?.trim()) {
    return NextResponse.json(
      { error: 'targetKind (app|agent) and targetId are required' },
      { status: 400 },
    );
  }
  const { trigger, secret } = await createWebhookTrigger({
    orgId,
    targetKind: body.targetKind,
    targetId: body.targetId.trim(),
    label: body.label?.trim() || '',
  });
  auditFromSession(gate, orgId, {
    action: 'trigger.webhook.create',
    resource: `webhook:${trigger.id} ${trigger.targetKind}:${trigger.targetId}`,
    outcome: 'ok',
  });
  // The secret + signing scheme are returned ONCE — the caller must store them now (only a ref is kept).
  return NextResponse.json(
    {
      ...trigger,
      url: publicUrl(trigger.token),
      secret,
      signing: {
        header: 'X-Offgrid-Signature',
        timestampHeader: 'X-Offgrid-Timestamp',
        scheme: 'sha256=HMAC_SHA256(secret, `${timestamp}.${rawBody}`)',
        windowSeconds: 300,
      },
    },
    { status: 201 },
  );
}

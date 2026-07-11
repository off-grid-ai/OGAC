import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { inboundAddressFor, inboundConfigFromEnv } from '@/lib/inbound-email';
import { currentOrgId } from '@/lib/tenancy';
import { isWebhookTargetKind } from '@/lib/webhook-trigger-policy';
import { createWebhookTrigger, listWebhookTriggers } from '@/lib/webhook-triggers';

export const dynamic = 'force-dynamic';

// Admin management of FORWARD-TO-ADDRESS inbound. An inbound address is a webhook trigger's token
// projected onto the inbound domain (`<token>@inbound.<host>`) — one trigger, two ingress shapes
// (HTTP webhook + inbound email). We reuse createWebhookTrigger to mint (no separate registry) and
// listWebhookTriggers to enumerate; here we only attach the inbound address + the provider setup note.
//
// GET → the org's inbound addresses (each bound trigger + its `<token>@<domain>` address) + config.
// POST → mint a new trigger for an app/agent and return its inbound address.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const cfg = inboundConfigFromEnv();
  const triggers = await listWebhookTriggers(orgId);
  const data = triggers.map((t) => ({
    ...t,
    inboundAddress: cfg.ok ? inboundAddressFor(t.token, cfg.domain!) : null,
  }));
  return NextResponse.json({
    object: 'list',
    configured: cfg.ok,
    domain: cfg.ok ? cfg.domain : null,
    configReason: cfg.ok ? 'ok' : cfg.reason,
    receiveEndpoint: '/api/v1/inbound/email',
    setup: cfg.ok
      ? `At your email provider, route inbound mail for @${cfg.domain} (or a specific address) to POST the parsed message to <console-host>/api/v1/inbound/email. The recipient <token>@${cfg.domain} selects the app/agent.`
      : 'Set OFFGRID_INBOUND_EMAIL_DOMAIN on the server to enable forward-to-address inbound.',
    data,
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
    return NextResponse.json({ error: 'targetKind (app|agent) and targetId are required' }, { status: 400 });
  }
  const { trigger } = await createWebhookTrigger({
    orgId,
    targetKind: body.targetKind,
    targetId: body.targetId.trim(),
    label: body.label?.trim() || '',
  });
  const cfg = inboundConfigFromEnv();
  auditFromSession(gate, orgId, {
    action: 'messaging.inbound.create',
    resource: `inbound:${trigger.id} ${trigger.targetKind}:${trigger.targetId}`,
    outcome: 'ok',
  });
  return NextResponse.json(
    {
      ...trigger,
      inboundAddress: cfg.ok ? inboundAddressFor(trigger.token, cfg.domain!) : null,
      configured: cfg.ok,
      note: cfg.ok
        ? `Forward or route email to ${inboundAddressFor(trigger.token, cfg.domain!)} to fire this ${trigger.targetKind}.`
        : cfg.reason,
    },
    { status: 201 },
  );
}

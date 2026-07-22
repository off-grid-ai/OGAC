import { NextResponse } from 'next/server';
import {
  persistWebhookSecret,
  removeWebhookSecret,
  resolveWebhookSecret,
} from '@/lib/adapters/sinks/webhook';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Admin management of the VAULTED webhook HMAC signing secret (org setting). We NEVER return the
// secret — only whether one is configured. POST writes it to OpenBao; DELETE removes it (an env
// OFFGRID_WEBHOOK_SECRET fallback, if any, still applies). The webhook sink refuses to POST an
// unsigned payload, so a signing secret is required before any webhook output step delivers.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({
    configured: (await resolveWebhookSecret()) !== null,
    note: 'The webhook signing secret is stored in the vault and never returned. It signs every outbound webhook payload (HMAC-SHA256).',
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => ({}))) as { secret?: string };
  const secret = (body.secret ?? '').trim();
  if (!secret) return NextResponse.json({ error: 'secret is required' }, { status: 400 });
  try {
    await persistWebhookSecret(secret);
  } catch (e) {
    return NextResponse.json({ error: `could not store secret: ${(e as Error).message}` }, { status: 502 });
  }
  auditFromSession(gate, orgId, {
    action: 'messaging.webhook.secret.set',
    resource: 'secret:org/webhook_secret',
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, configured: (await resolveWebhookSecret()) !== null });
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  await removeWebhookSecret();
  auditFromSession(gate, orgId, {
    action: 'messaging.webhook.secret.remove',
    resource: 'secret:org/webhook_secret',
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, configured: (await resolveWebhookSecret()) !== null });
}

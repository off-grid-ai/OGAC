import { NextResponse } from 'next/server';
import {
  isResendSinkConfigured,
  persistResendApiKey,
  removeResendApiKey,
  resendConfigFromEnv,
} from '@/lib/adapters/sinks/email-resend';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Admin management of the VAULTED Resend API key (org setting). We NEVER return the key — only whether
// it is configured + whether a From sender is set. POST writes the key to OpenBao; DELETE removes it
// (an env RESEND_API_KEY fallback, if any, still applies). The real key lives in mobile/.env.keygen as
// RESEND_API_KEY and is wired into the vault by the orchestrator post-merge.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const cfg = resendConfigFromEnv();
  return NextResponse.json({
    configured: await isResendSinkConfigured(),
    from: cfg.ok ? cfg.config!.from : null,
    fromReason: cfg.ok ? 'ok' : cfg.reason,
    note: 'The Resend API key is stored in the vault and never returned. Set RESEND_FROM (a verified sender) to complete the sink.',
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => ({}))) as { key?: string };
  const key = (body.key ?? '').trim();
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });
  try {
    await persistResendApiKey(key);
  } catch (e) {
    return NextResponse.json({ error: `could not store key: ${(e as Error).message}` }, { status: 502 });
  }
  auditFromSession(gate, orgId, {
    action: 'messaging.resend.key.set',
    resource: 'secret:org/resend_api_key',
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, configured: await isResendSinkConfigured() });
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  await removeResendApiKey();
  auditFromSession(gate, orgId, {
    action: 'messaging.resend.key.remove',
    resource: 'secret:org/resend_api_key',
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, configured: await isResendSinkConfigured() });
}

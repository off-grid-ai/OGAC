import { NextResponse } from 'next/server';
import {
  isSlackSinkConfigured,
  persistSlackWebhookUrl,
  removeSlackWebhookUrl,
} from '@/lib/adapters/sinks/slack';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Admin management of the VAULTED Slack incoming-webhook URL (org setting). The URL is itself a secret
// (anyone with it can post to your channel), so we NEVER return it — only whether one is configured.
// POST writes it to OpenBao; DELETE removes it (an env SLACK_WEBHOOK_URL fallback, if any, still
// applies). Once set, a `slack` output step delivers the run outcome to that channel.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({
    configured: await isSlackSinkConfigured(),
    note: 'The Slack incoming-webhook URL is stored in the vault and never returned. Create one in Slack (Incoming Webhooks) and paste it here.',
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? '').trim();
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  if (!/^https:\/\/hooks\.slack\.com\/\S+$/i.test(url)) {
    return NextResponse.json(
      { error: 'url must be a Slack incoming-webhook URL (https://hooks.slack.com/…)' },
      { status: 400 },
    );
  }
  try {
    await persistSlackWebhookUrl(url);
  } catch (e) {
    return NextResponse.json({ error: `could not store url: ${(e as Error).message}` }, { status: 502 });
  }
  auditFromSession(gate, orgId, {
    action: 'messaging.slack.webhook.set',
    resource: 'secret:org/slack_webhook_url',
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, configured: await isSlackSinkConfigured() });
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  await removeSlackWebhookUrl();
  auditFromSession(gate, orgId, {
    action: 'messaging.slack.webhook.remove',
    resource: 'secret:org/slack_webhook_url',
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, configured: await isSlackSinkConfigured() });
}

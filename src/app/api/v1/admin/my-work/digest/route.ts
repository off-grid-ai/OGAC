import { NextResponse } from 'next/server';
import { sendViaResend } from '@/lib/adapters/sinks/email-resend';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { listApps } from '@/lib/apps-store';
import { runSubject } from '@/lib/app-work-queue';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { daysWaiting } from '@/lib/my-work';
import { listUsers } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { buildDigest, digestRecipients, type DigestCase } from '@/lib/waiting-digest';

export const dynamic = 'force-dynamic';

// ─── The nudge that tells someone work is waiting ────────────────────────────────────────────────────
//
// Nothing in the product told a person a case needed them. The nav badge covers someone already looking
// at the console; this covers someone who is not — which is the case that actually failed. Measured on
// this tenant before the fix: cases sitting ten days under "nobody has picked this up".
//
// GET  → preview. Exactly what would be sent and to whom, sending nothing. This exists so the behaviour
//        is verifiable without mailing an org, and so an operator can see who is on the list.
// POST → send, and report per recipient. A delivery that fails says why rather than being swallowed.

async function gather(orgId: string) {
  const [apps, runs, users] = await Promise.all([
    listApps(orgId).catch(() => []),
    listAppRunsView(undefined, orgId, 300).catch(() => []),
    listUsers(orgId).catch(() => []),
  ]);
  const titleById = new Map(apps.map((a) => [a.id, a.title]));
  const now = new Date();

  const cases: DigestCase[] = runs
    .filter((r) => String(r.status) === 'awaiting_human')
    // A case whose app is gone cannot be acted on, so nobody should be nudged about it.
    .filter((r) => titleById.has(r.appId))
    .map((r) => ({
      appTitle: titleById.get(r.appId) ?? r.appId,
      label:
        runSubject((r as { input?: unknown }).input) ??
        `Unnamed case in ${titleById.get(r.appId) ?? r.appId}`,
      daysWaiting: daysWaiting(String(r.startedAt ?? ''), now),
    }));

  return { cases, recipients: digestRecipients(users) };
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const url = new URL(req.url);
  const consoleUrl = `${url.protocol}//${url.host}`;

  const { cases, recipients } = await gather(orgId);
  const message = buildDigest(cases, consoleUrl);

  return NextResponse.json({
    // Null message is the normal, quiet case: nothing has waited long enough to interrupt anyone.
    wouldSend: message !== null,
    recipients: recipients.map((r) => r.email),
    waitingTotal: cases.length,
    message,
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const url = new URL(req.url);
  const consoleUrl = `${url.protocol}//${url.host}`;

  const { cases, recipients } = await gather(orgId);
  const message = buildDigest(cases, consoleUrl);
  if (!message) {
    return NextResponse.json({ sent: 0, reason: 'Nothing has waited long enough to be worth a nudge.' });
  }
  if (recipients.length === 0) {
    // Not an error, and not silence either: a digest with nobody to send it to is a real state an
    // operator needs to see, because it means the queue has no one who can act on it.
    return NextResponse.json({
      sent: 0,
      reason: 'No account in this organization has a role that can decide these cases.',
    });
  }

  const delivered: { to: string; ok: boolean; reason?: string; configured?: boolean }[] = [];
  for (const r of recipients) {
    const res = await sendViaResend(
      { to: r.email, subject: message.subject, text: message.text },
      { tags: { type: 'waiting_digest', org: orgId } },
    ).catch((e: unknown) => ({
      ok: false,
      configured: true,
      reason: e instanceof Error ? e.message : 'send failed',
    }));
    delivered.push({ to: r.email, ok: res.ok, reason: res.reason, configured: res.configured });
  }

  auditFromSession(gate, orgId, {
    action: 'work.digest.sent',
    resource: `recipients:${delivered.length}`,
    outcome: delivered.some((d) => d.ok) ? 'ok' : 'error',
  });

  return NextResponse.json({
    sent: delivered.filter((d) => d.ok).length,
    failed: delivered.filter((d) => !d.ok).length,
    delivered,
  });
}

import { NextResponse } from 'next/server';
import { getPii } from '@/lib/adapters/registry';
import { getAppBySlug } from '@/lib/apps-store';
import { requireUser } from '@/lib/authz';
import { cockpitRows } from '@/lib/cockpit-fixtures';
import { buildCockpitDigest } from '@/lib/cockpit-digest';
import { computeCockpitMetrics } from '@/lib/cockpit-metrics';
import {
  emailEgressVerdict,
  emailMaskingRequired,
  maskEmailForSend,
} from '@/lib/email-sink-governance';
import { resolveContract } from '@/lib/pipeline-contract';

export const dynamic = 'force-dynamic';

// ─── POST /api/v1/app/<slug>/send-report — live "Send report now" from the USE surface ────────────
//
// Renders the cockpit weekly digest for a published app and emails it through the SAME governed email
// sinks the scheduled run uses (Resend when configured, else on-prem SMTP). Governed, not wide open:
// a verified principal (session / service token / admin) is required. Honest: when no email transport
// is configured on this deployment it returns { ok:false, configured:false } — never a fake "sent".
// SOLID: thin handler over the PURE digest builder + the existing sink adapters. Aggregate-only body.
function isEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const { slug } = await params;
  const app = await getAppBySlug(slug);
  if (!app || !app.published) {
    return NextResponse.json({ ok: false, reason: 'app not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { to?: unknown; note?: unknown };
  if (!isEmail(body.to)) {
    return NextResponse.json({ ok: false, reason: 'a valid recipient email is required' }, { status: 400 });
  }
  const to = String(body.to).trim();
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : undefined;

  // Render the digest from the cockpit metrics (sample data today; live data-domain when bound).
  const metrics = computeCockpitMetrics(cockpitRows());
  const digest = buildCockpitDigest(metrics, { appTitle: app.title, note });
  let subject = digest.subject;
  let text = digest.text;

  try {
    // Prefer Resend when configured; else on-prem SMTP — the same order app-run uses.
    const { resendConfigFromEnv, sendViaResend } = await import('@/lib/adapters/sinks/email-resend');
    const provider = resendConfigFromEnv().ok ? 'resend' : 'smtp';

    // GOVERNANCE — the SAME email-sink governance the app-run output step applies (one authority):
    //   1. Egress leash: a cloud send (Resend) is DENIED when the app's bound pipeline is leashed
    //      on-prem-only — a local pipeline must not fan its result out through a third-party mailer.
    //   2. PII mask: when masking is required, the subject + body are redacted BEFORE they leave.
    const contract = await resolveContract(app.pipelineId ?? null, app.orgId);
    const egress = emailEgressVerdict(contract, provider);
    if (!egress.allow) {
      return NextResponse.json(
        { ok: false, configured: true, reason: `blocked by pipeline egress leash: ${egress.reason}` },
        { status: 403 },
      );
    }
    if (emailMaskingRequired(contract)) {
      const scan = (t: string) => getPii().scan(t, app.orgId);
      const [scanSubject, scanText] = await Promise.all([scan(subject), scan(text)]);
      const masked = maskEmailForSend(subject, text, true, scanSubject, scanText);
      subject = masked.subject;
      text = masked.text;
    }

    const msg = { to, subject, text };
    if (provider === 'resend') {
      const r = await sendViaResend({ ...msg }, { html: true, tags: { source: 'offgrid_cockpit_report' } });
      return NextResponse.json(r, { status: 200 });
    }
    const { sendEmail } = await import('@/lib/adapters/sinks/email-smtp');
    const r = await sendEmail(msg);
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    console.error('send-report failed:', e);
    return NextResponse.json({ ok: false, configured: true, reason: 'delivery error' }, { status: 500 });
  }
}

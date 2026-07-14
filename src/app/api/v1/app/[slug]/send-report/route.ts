import { NextResponse } from 'next/server';
import { getAppBySlug } from '@/lib/apps-store';
import { requireUser } from '@/lib/authz';
import { cockpitRows } from '@/lib/cockpit-fixtures';
import { buildCockpitDigest } from '@/lib/cockpit-digest';
import { computeCockpitMetrics } from '@/lib/cockpit-metrics';

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
  const msg = { to, subject: digest.subject, text: digest.text };

  try {
    // Prefer Resend when configured; else on-prem SMTP — the same order app-run uses.
    const { resendConfigFromEnv, sendViaResend } = await import('@/lib/adapters/sinks/email-resend');
    if (resendConfigFromEnv().ok) {
      const r = await sendViaResend(
        { ...msg },
        { html: true, tags: { source: 'offgrid_cockpit_report' } },
      );
      return NextResponse.json(r, { status: r.ok ? 200 : 200 });
    }
    const { sendEmail } = await import('@/lib/adapters/sinks/email-smtp');
    const r = await sendEmail(msg);
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    console.error('send-report failed:', e);
    return NextResponse.json({ ok: false, configured: true, reason: 'delivery error' }, { status: 500 });
  }
}

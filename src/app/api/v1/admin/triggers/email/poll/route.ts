import { NextResponse } from 'next/server';
import { isEmailTriggerConfigured, pollEmailTriggers } from '@/lib/adapters/triggers/email-imap';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Email-in trigger POLLER (Builder Epic #103, Phase 4C) — the invocable caller ─────────────────
//
// POST /api/v1/admin/triggers/email/poll — runs ONE poll cycle of the on-prem IMAP inbox. It is the
// real caller for the existing pollEmailTriggers() (previously implemented but unwired). Each new
// UNSEEN message that names a published email-triggered app (by `+slug` recipient or `[app:slug]`
// subject tag) starts a GOVERNED app-run through the SAME submitAppRun entry point on-demand runs use
// — so policy / guardrails / grounding / signing all apply identically. Processed messages are marked
// \Seen so they fire exactly once.
//
// GET → a lightweight STATUS probe (is the on-prem IMAP env configured?) for the console's trigger
// health card; it does NOT connect or mutate anything.
//
// INTENDED INVOCATION on-prem (this route is the entry point for all of them):
//   • a launchd/cron job every N minutes: `curl -s -X POST -H "Authorization: Bearer $OFFGRID_ADMIN_TOKEN" \
//       https://<console>/api/v1/admin/triggers/email/poll`
//   • or a systemd timer / the platform's own scheduler hitting the same URL.
// The poller is stateless + idempotent per message (\Seen is the dedupe), so a fixed interval is safe.
//
// REQUIRED on-prem env (all air-gap: we connect ONLY to the host the operator sets — no cloud path):
//   OFFGRID_EMAIL_IMAP_URL   — imaps://host[:port] (or a bare host[:port]); implicit TLS for a bare host
//   OFFGRID_EMAIL_IMAP_USER  — mailbox login
//   OFFGRID_EMAIL_IMAP_PASS  — mailbox password
//   OFFGRID_EMAIL_IMAP_MAILBOX — folder to poll (optional; default INBOX)
// Unset → the poller stays DISABLED and reports "not configured" (never silently reaches a cloud mailbox).

// GET → status only (does the on-prem IMAP env exist?). Admin-gated so it isn't world-readable.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const configured = isEmailTriggerConfigured();
  return NextResponse.json({
    configured,
    note: configured
      ? 'On-prem IMAP configured. POST here (on an interval) to poll for inbound email triggers.'
      : 'Email trigger not configured — set OFFGRID_EMAIL_IMAP_URL/_USER/_PASS on the server to enable.',
  });
}

// POST → run one poll cycle. Thin: auth → poll (adapter does the I/O + governed submit) → audit.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();

  const result = await pollEmailTriggers();

  auditFromSession(gate, orgId, {
    action: 'trigger.email.poll',
    resource: 'trigger:email',
    outcome: result.configured ? (result.errors.length ? 'error' : 'ok') : 'ok',
  });

  // 200 with the honest cycle summary. When unconfigured, configured:false + note (not an error — the
  // operator simply hasn't wired the on-prem inbox yet).
  return NextResponse.json(result, { status: 200 });
}

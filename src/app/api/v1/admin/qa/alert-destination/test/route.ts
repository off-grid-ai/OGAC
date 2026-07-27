import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import type { QualityAlert } from '@/lib/qa/quality-alert-plan';
import { destinationConfigured, sendQualityAlert, validAlertUrl } from '@/lib/qa/quality-alert-dispatch';
import { resolveOrgDestination } from '@/lib/qa/quality-alert-run';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST — deliver a clearly-marked test alert so an operator can prove the destination works BEFORE a
// real regression depends on it. Without this, the first time anyone learns the URL is wrong is the
// moment quality actually slipped, which is the worst possible time to find out.
//
// A caller may pass a `url` to test a candidate destination before saving it; otherwise the org's
// resolved destination (console setting, else env fallback) is used.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const orgId = await currentOrgId();

  const candidate = validAlertUrl(body?.url);
  const resolved = candidate ? null : await resolveOrgDestination(orgId);
  const url = candidate ?? resolved?.url ?? null;

  // "Can we deliver?" is channel-dependent, so it must NOT be `!url`. A Slack destination has no URL
  // of its own — the sink holds the incoming-webhook URL — so a bare url check rejected a perfectly
  // valid Slack setup and made it untestable. Caught by the live probe, not by any unit test.
  const deliverable = candidate !== null || (resolved ? destinationConfigured(resolved) : false);
  if (!deliverable) {
    return NextResponse.json(
      {
        error: resolved?.paused
          ? 'Quality alerts are paused — enable the destination before sending a test.'
          : 'No destination configured. Save a destination first, or pass one as `url`.',
      },
      { status: 400 },
    );
  }

  // A test alert is explicitly labelled so nobody mistakes it for a real quality problem.
  const alert: QualityAlert = {
    kind: 'regressed',
    subjectId: 'test:connection-check',
    detail:
      'This is a TEST alert from Off Grid AI, sent because someone checked this destination. No app quality has changed.',
    recentQuality: 0,
    baselineQuality: 0,
    dimensions: [],
    at: new Date().toISOString(),
  };

  const result = await sendQualityAlert(
    alert,
    orgId,
    url,
    undefined,
    undefined,
    undefined,
    resolved?.channel ?? 'webhook',
  );
  auditFromSession(gate, orgId, {
    action: 'qa.alert-destination.test',
    resource: `quality-alert-destination:${orgId}`,
    outcome: result.ok ? 'ok' : 'error',
  });

  // A failed delivery is reported honestly with the real reason (status / unreachable), and is NOT
  // an API error — the request succeeded, the destination did not.
  return NextResponse.json({
    object: 'quality_alert_test',
    delivered: result.ok,
    configured: result.configured,
    status: result.status ?? null,
    reason: result.reason,
    source: candidate ? 'candidate' : (resolved?.source ?? 'none'),
  });
}

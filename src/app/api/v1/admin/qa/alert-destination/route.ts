import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  deleteAlertDestination,
  getAlertDestination,
  setAlertDestination,
} from '@/lib/qa/quality-alert-destination-store';
import { resolveDestination, validAlertUrl } from '@/lib/qa/quality-alert-dispatch';
import { currentOrgId } from '@/lib/tenancy';

// Where this tenant's answer-quality alerts are delivered — full CRUD, so an operator configures it
// in the console instead of editing an env file on the server.
//
// Thin handlers: validity (validAlertUrl) and precedence (resolveDestination) are pure rules shared
// with the dispatcher, so the UI cannot accept a destination the sender would then reject.

export const dynamic = 'force-dynamic';

/** GET — the configured destination plus which source is actually in force. */
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const orgId = await currentOrgId();
  const stored = await getAlertDestination(orgId);
  const resolved = resolveDestination(stored ? { url: stored.url, enabled: stored.enabled } : null);

  return NextResponse.json({
    object: 'quality_alert_destination',
    destination: stored,
    // `source: 'env'` tells the operator alerts are going somewhere they cannot see in the console —
    // worth surfacing rather than showing an empty form that looks like "alerts are off".
    active: resolved,
  });
}

/** PUT — create or replace the destination. */
export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as { url?: unknown; enabled?: unknown } | null;
  const url = validAlertUrl(body?.url);
  if (!url) {
    return NextResponse.json(
      { error: 'a destination url is required and must be an http(s):// endpoint' },
      { status: 400 },
    );
  }
  const enabled = body?.enabled !== false;

  const orgId = await currentOrgId();
  try {
    await setAlertDestination(orgId, url, enabled, gate.user.email ?? undefined);
    auditFromSession(gate, orgId, {
      action: 'qa.alert-destination.set',
      resource: `quality-alert-destination:${orgId}`,
      outcome: 'ok',
    });
  } catch (err) {
    return NextResponse.json(
      { error: `could not save the destination: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ object: 'quality_alert_destination', destination: await getAlertDestination(orgId) });
}

/** DELETE — remove the destination (alerts fall back to the env var, or stop). */
export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const orgId = await currentOrgId();
  try {
    const removed = await deleteAlertDestination(orgId);
    auditFromSession(gate, orgId, {
      action: 'qa.alert-destination.delete',
      resource: `quality-alert-destination:${orgId}`,
      outcome: removed ? 'ok' : 'not-found',
    });
    return NextResponse.json({ object: 'quality_alert_destination', removed });
  } catch (err) {
    return NextResponse.json(
      { error: `could not remove the destination: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

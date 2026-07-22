import { gunzipSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { normalizeDecisionEvents } from '@/lib/opa-audit';
import { persistDecisions } from '@/lib/opa-decision-log-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// OPA DECISION-LOG SINK. OPA's decision_logs plugin ships an array of decision events to a configured
// HTTP service (its `service`/`resource`), authenticating with a bearer token — so this endpoint
// speaks OPA's upload protocol: it accepts a gzip'd (or plain) JSON array of decision events, and
// authorizes with the same admin/service-account bearer the rest of the admin plane uses.
//
// Point the deployed OPA at it with:
//   decision_logs: { service: "console", resource: "/api/v1/admin/policy/decision-logs/ingest" }
//   services: { console: { url: "https://<console>", credentials: { bearer: { token: "<admin>" } } } }
//
// Each event is normalized (pure opa-audit) and persisted idempotently (per decision_id) into the
// org's ledger. Returns how many rows were written so OPA/an operator can confirm delivery.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();

  let parsed: unknown;
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    const encoding = req.headers.get('content-encoding') ?? '';
    const text = encoding.includes('gzip') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    parsed = text.trim() ? JSON.parse(text) : [];
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid decision-log payload', detail: (e as Error).message },
      { status: 400 },
    );
  }

  const events = normalizeDecisionEvents(parsed);
  const written = await persistDecisions(events, org);
  auditFromSession(gate, org, {
    action: 'policy.decision-log.ingest',
    resource: `opa:${written}-decisions`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, received: events.length, persisted: written });
}

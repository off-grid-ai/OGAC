import { NextResponse } from 'next/server';
import { isActionableRecord, primaryDomainLabel, toCaseCandidate } from '@/lib/app-case-candidates';
import { getApp } from '@/lib/apps-store';
import { requireAdmin } from '@/lib/authz';
import { execConnectorQuery } from '@/lib/connector-exec';
import { listConnectors } from '@/lib/store';
import { listDomains } from '@/lib/data-domains-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── GAP 0: the records this app could work on ───────────────────────────────────────────────────────
//
// Starting a case was a free-text box, so a person re-typed data the organisation already holds. This lists
// the real candidate records from the data domain the app's first connector-query step reads, so a case can
// be started by PICKING one.
//
// Thin: which domain, and how to describe a row, are pure (app-case-candidates.ts). This resolves the
// connector and runs the read.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const label = primaryDomainLabel(app.steps as { kind?: string; domain?: string }[]);
  if (!label) {
    // Honest: this app reads no data domain, so there is nothing to pick from. The caller shows manual
    // entry rather than an empty picker that looks broken.
    return NextResponse.json({ object: 'list', data: [], reason: 'no-data-domain' });
  }

  const domains = await listDomains(orgId).catch(() => []);
  const domain = domains.find((d) => d.label.trim().toLowerCase() === label.toLowerCase());
  if (!domain?.connectorId || !domain.resource) {
    return NextResponse.json({ object: 'list', data: [], reason: 'domain-not-bound', domain: label });
  }

  const connector = (await listConnectors(orgId).catch(() => [])).find(
    (c) => c.id === domain.connectorId,
  );
  if (!connector) {
    return NextResponse.json({ object: 'list', data: [], reason: 'connector-missing', domain: label });
  }

  const result = await execConnectorQuery(
    { type: connector.type, endpoint: connector.endpoint, id: connector.id, orgId },
    { resource: domain.resource, op: 'read', limit: 20, binding: { orgId, domainId: domain.id } },
  ).catch(() => null);

  if (!result) {
    // A source that cannot be read is reported as such — never as "no cases", which would read as an
    // empty queue rather than a connection problem.
    return NextResponse.json({ object: 'list', data: [], reason: 'source-unavailable', domain: label });
  }

  // Only records that still need a decision are offered. A paid invoice is not a reimbursement waiting to
  // be approved, and mixing settled rows in invites someone to act on something already done. The count of
  // what was filtered is returned so the UI can say so rather than silently showing a shorter list.
  const rows = result.rows as Record<string, unknown>[];
  const actionable = rows.filter(isActionableRecord);
  return NextResponse.json({
    object: 'list',
    domain: label,
    settledHidden: rows.length - actionable.length,
    data: actionable.map((row, i) => toCaseCandidate(row, i)),
  });
}

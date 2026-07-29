import { NextResponse } from 'next/server';
import { isActionableRecord, primaryDomainLabel, toCaseCandidate } from '@/lib/app-case-candidates';
import { resolveDomainByIdOrLabel } from '@/lib/app-run';
import { resolveDomain } from '@/lib/data-domains';
import { getApp } from '@/lib/apps-store';
import { requireAdmin } from '@/lib/authz';
import { execConnectorRead } from '@/lib/connector-exec';
import { connectorFailureSentence, describeThrown } from '@/lib/connector-failure';
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

  // What the STEP declares — an id on a compiled spec, a phrase on a hand-written one. Never shown to a
  // person: `dom_7d17b157-0e6` is not the name of anything. The resolved domain's own label is.
  const declared = primaryDomainLabel(app.steps as { kind?: string; domain?: string }[]);
  if (!declared) {
    // Honest: this app reads no data domain, so there is nothing to pick from. The caller shows manual
    // entry rather than an empty picker that looks broken.
    return NextResponse.json({ object: 'list', data: [], reason: 'no-data-domain' });
  }

  // Resolve exactly the way the RUN does — by domain id first (which is what a compiled spec emits),
  // then by label/alias. Matching on label alone made the picker report "not connected yet" for every
  // app whose spec was compiled, while the run itself read the same domain fine.
  const domains = await listDomains(orgId).catch(() => []);
  const domain = resolveDomainByIdOrLabel(declared, domains, resolveDomain);
  if (!domain?.connectorId || !domain.resource) {
    // Unresolved: there is no human label to give, so say which reference failed rather than inventing one.
    return NextResponse.json({ object: 'list', data: [], reason: 'domain-not-bound' });
  }
  const label = domain.label?.trim() || declared;

  const connector = (await listConnectors(orgId).catch(() => [])).find(
    (c) => c.id === domain.connectorId,
  );
  if (!connector) {
    return NextResponse.json({ object: 'list', data: [], reason: 'connector-missing', domain: label });
  }

  const outcome = await execConnectorRead(
    { type: connector.type, endpoint: connector.endpoint, id: connector.id, orgId },
    { resource: domain.resource, op: 'read', limit: 20, binding: { orgId, domainId: domain.id } },
  ).catch((error: unknown) => ({ ok: false as const, failure: { kind: 'connection' as const, detail: describeThrown(error) } }));

  if (!outcome.ok) {
    // A source that cannot be read is reported as such — never as "no cases", which would read as an
    // empty queue rather than a connection problem. The reason is carried so the operator sees WHAT to
    // fix instead of a shrug.
    return NextResponse.json({
      object: 'list',
      data: [],
      reason: 'source-unavailable',
      domain: label,
      detail: connectorFailureSentence(outcome.failure),
    });
  }
  const result = outcome.result;

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

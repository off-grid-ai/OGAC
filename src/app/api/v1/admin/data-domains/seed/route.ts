import { NextResponse } from 'next/server';
import { createApp, listApps } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  buildReimbursementAppSpec,
  planConnectors,
  planDomains,
  shouldSeedSampleApp,
} from '@/lib/data-domains-demo-seed';
import { createDomain, listDomains } from '@/lib/data-domains-store';
import { createConnector, listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Demo seed route (Builder Epic task #106) ─────────────────────────────────────────────────────
// POST /api/v1/admin/data-domains/seed — declare the demo connectors + data-domains bound to the
// REAL on-prem data sources (deploy/onprem/data-sources.yml) and (optionally) the ready-made
// "Reimbursement Approval" sample app. Makes the flagship reimbursement use case clickable end-to-end.
//
// IDEMPOTENT: connectors matched by name, domains by label, sample app by title — a re-run creates
// only what's missing. HONEST: a domain whose backing connector is absent is SKIPPED (reported as
// `unbacked`), never bound to a fabricated connector. Thin handler: all decisions are the pure
// planners in data-domains-demo-seed.ts.
//
// Body (optional): { sampleApp?: boolean } — set false to skip seeding the sample app.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => ({}))) as { sampleApp?: boolean } | null;
  const wantSampleApp = body?.sampleApp !== false;

  const orgId = await currentOrgId();
  const ownerId = gate.user.email ?? 'service@offgrid.local';

  // 1. Connectors — create the ones missing by name.
  const existingConnectors = await listConnectors(orgId);
  const connPlan = planConnectors(existingConnectors.map((c) => ({ id: c.id, name: c.name })));
  const createdConnectors: string[] = [];
  for (const c of connPlan.toCreate) {
    await createConnector({
      name: c.name,
      type: c.type,
      endpoint: c.endpoint,
      description: c.description,
      orgId,
      custom: true,
    });
    createdConnectors.push(c.name);
  }

  // 2. Build name → real-id map from the now-current connector set.
  const allConnectors = await listConnectors(orgId);
  const connectorsByName = new Map(allConnectors.map((c) => [c.name.trim().toLowerCase(), c.id]));

  // 3. Domains — create the ones missing by label, bound ONLY to connectors that exist.
  const existingDomains = await listDomains(orgId);
  const domPlan = planDomains(
    existingDomains.map((d) => ({ id: d.id, label: d.label })),
    connectorsByName,
  );
  const createdDomains: string[] = [];
  for (const d of domPlan.toCreate) {
    await createDomain(
      { label: d.label, connectorId: d.connectorId, resource: d.resource, aliases: d.aliases, opHints: d.opHints },
      orgId,
    );
    createdDomains.push(d.label);
  }

  // 4. Sample app — create the "Reimbursement Approval" app if none with that title exists.
  let createdApp: string | null = null;
  if (wantSampleApp) {
    const existingApps = await listApps(orgId);
    if (shouldSeedSampleApp(existingApps.map((a) => a.title))) {
      const spec = buildReimbursementAppSpec(orgId, ownerId);
      const app = await createApp(orgId, ownerId, {
        title: spec.title,
        summary: spec.summary,
        visibility: spec.visibility,
        trigger: spec.trigger,
        steps: spec.steps,
        edges: spec.edges,
      });
      createdApp = app.id;
    }
  }

  auditFromSession(gate, orgId, {
    action: 'data-domain.seed',
    resource: 'data-domain:demo-seed',
    outcome: 'ok',
  });

  return NextResponse.json({
    ok: true,
    connectors: {
      created: createdConnectors,
      present: connPlan.present.map((c) => c.name),
    },
    domains: {
      created: createdDomains,
      present: domPlan.present.map((d) => d.label),
      unbacked: domPlan.unbacked.map((d) => `${d.label} (needs connector "${d.connectorKey}")`),
    },
    sampleApp: createdApp ? { created: createdApp } : { skipped: 'already exists or disabled' },
  });
}

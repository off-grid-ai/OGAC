import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { proposeCatalogAssets } from '@/lib/data-catalog-seed';
import { createAsset, listAssets } from '@/lib/data-catalog-store';
import { listDomains } from '@/lib/data-domains-store';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → the PROPOSED starter catalog derived from the org's real connectors + data-domains (never
// fabricated). POST → materialize those proposals as real data_assets. Seeding the catalog from
// what's already declared is how "what data do I have" starts non-empty for an existing org.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const [connectors, domains, existing] = await Promise.all([
    listConnectors(org),
    listDomains(org),
    listAssets(org),
  ]);
  const proposals = proposeCatalogAssets(
    connectors.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    domains.map((d) => ({ id: d.id, label: d.label, connectorId: d.connectorId, resource: d.resource })),
    existing.map((a) => a.name),
  );
  return NextResponse.json({ object: 'list', data: proposals });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const [connectors, domains, existing] = await Promise.all([
    listConnectors(org),
    listDomains(org),
    listAssets(org),
  ]);
  const proposals = proposeCatalogAssets(
    connectors.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    domains.map((d) => ({ id: d.id, label: d.label, connectorId: d.connectorId, resource: d.resource })),
    existing.map((a) => a.name),
  );
  const created = [];
  for (const p of proposals) {
    created.push(
      await createAsset(
        { name: p.name, source: p.source, connectorId: p.connectorId, domainId: p.domainId, kind: p.kind },
        org,
      ),
    );
  }
  auditFromSession(gate, org, {
    action: 'data-asset.seed',
    resource: `org:${org}`,
    outcome: 'ok',
  });
  return NextResponse.json({ object: 'list', data: created, seeded: created.length }, { status: 201 });
}

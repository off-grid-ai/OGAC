import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { isGovernedKafkaConnector } from '@/lib/adapters/kafka-source-onboarding';
import { requireAdmin } from '@/lib/authz';
import { getConnector } from '@/lib/connector-detail';
import { createDomain, listDomains } from '@/lib/data-domains-store';
import { validateDomainForm } from '@/lib/data-domains-ui';
import { currentOrgId } from '@/lib/tenancy';

// Connector rule-engine declarations (Builder Epic §3.2): the org's "customer data → Salesforce",
// "transactions → Postgres" bindings. Admin-gated, org-scoped, thin — the pure resolver lives in
// data-domains.ts and persistence in data-domains-store.ts.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listDomains(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  // Validate through the same pure rule the form uses. Aliases may arrive pre-split (string[]) or
  // as raw text; normalize to the raw form the validator expects.
  const aliasesRaw = Array.isArray(body?.aliases)
    ? (body!.aliases as unknown[]).map(String).join(', ')
    : ((body?.aliasesRaw as string | undefined) ?? '');
  const result = validateDomainForm({
    label: (body?.label as string | undefined) ?? '',
    connectorId: (body?.connectorId as string | undefined) ?? '',
    resource: (body?.resource as string | undefined) ?? '',
    aliasesRaw,
  });
  if (!result.ok || !result.value) {
    return NextResponse.json({ error: 'invalid domain', fields: result.errors }, { status: 400 });
  }

  const orgId = await currentOrgId();
  if (!(await getConnector(result.value.connectorId, orgId))) {
    return NextResponse.json({ error: 'The selected data source was not found.' }, { status: 404 });
  }
  if (await isGovernedKafkaConnector(result.value.connectorId, orgId)) {
    return NextResponse.json(
      {
        error: 'Manage this governed event source from its source page.',
        manageAt: '/api/v1/admin/kafka-sources',
      },
      { status: 409 },
    );
  }
  const opHints =
    body?.opHints && typeof body.opHints === 'object'
      ? (body.opHints as Record<string, unknown>)
      : undefined;
  const created = await createDomain({ ...result.value, opHints }, orgId);
  auditFromSession(gate, orgId, {
    action: 'data-domain.create',
    resource: `data-domain:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}

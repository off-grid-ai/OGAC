import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { GatewayDetail } from '@/components/gateways/GatewayDetail';
import { getGatewayWithHealth } from '@/lib/gateways';
import { MODEL_CATALOG, getModelSpec, type ModelSpec } from '@/lib/model-catalog';
import { listPipelinesByGateway } from '@/lib/pipelines';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Gateway DETAIL (list → detail). Full entity + all its actions: honest health, egress class, base
// URL / auth presence (never a secret), the model catalog for the gateway, on-prem node pool health,
// and the pipelines bound to it. Delete + edit live here too (edit deep-links back to the list panel).
//
// The model catalog shown depends on the gateway's egress class:
//  • on-prem → the models the fleet can actually serve (reconciled against live node tags client-side
//    in GatewayDetail; the static fleet-served set is passed as the baseline).
//  • cloud   → the gateway's default model spec if it's a known catalog entry (published specs), else
//    an honest "spec not in catalog" note. Cloud providers expose thousands of models; we don't guess.
export default async function GatewayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('gateways');
  const { id } = await params;
  const orgId = await currentOrgId();
  const gateway = await getGatewayWithHealth(id, orgId);
  if (!gateway) notFound();
  const pipelines = await listPipelinesByGateway(id, orgId).catch(() => []);

  // Real published specs for the models this gateway is relevant to — never fabricated.
  const isOnPrem = gateway.egressClass === 'on-prem';
  const fleetBaseline: ModelSpec[] = MODEL_CATALOG.filter((m) => m.servedOnFleet);
  const defaultSpec = gateway.defaultModel ? (getModelSpec(gateway.defaultModel) ?? null) : null;

  // PA-15: prefill the "provision endpoint" form with the current tenant's slug when this request is
  // on a tenant subdomain (x-offgrid-tenant-slug, set by middleware from the TRUSTED host). Off a
  // tenant subdomain the operator types the tenant slug themselves.
  const tenantSlug = (await headers()).get('x-offgrid-tenant-slug') ?? '';

  return (
    <GatewayDetail
      gateway={gateway}
      tenantSlug={tenantSlug}
      pipelines={pipelines.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        visibility: p.visibility,
        defaultModel: p.defaultModel ?? null,
      }))}
      isOnPrem={isOnPrem}
      fleetModelBaseline={fleetBaseline}
      defaultModelSpec={defaultSpec}
    />
  );
}

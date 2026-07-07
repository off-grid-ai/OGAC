import { notFound } from 'next/navigation';
import { PipelineOverview } from '@/components/pipelines/PipelineOverview';
import { listEvalDefs } from '@/lib/eval-defs';
import { listGoldenCases } from '@/lib/evals';
import { listGuardrailRules } from '@/lib/guardrails-rules';
import { getPipeline, listPipelineVersions } from '@/lib/pipelines';
import { listPolicyRules } from '@/lib/policy-rules';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// A best-effort count that never throws — a peripheral read failing must not 500 the Overview.
async function countOf<T>(p: Promise<T[]>): Promise<number> {
  return p.then((r) => r.length).catch(() => 0);
}

// The pipeline Overview tab (base route /pipelines/<id>) — the comprehensive, editable heart-of-the-
// product surface. Reads the pipeline + its real peripheral facts (evals/golden attach counts, org
// rule counts, version history) so the dashboard is honest, never fabricated. Per-pipeline attach
// counts key on the pipeline id; org rule counts are the inherited defaults.
export default async function PipelineOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPipeline(id, orgId);
  if (!p) notFound();

  const [evalsAttached, goldenCases, orgPolicyRules, orgGuardrailRules, versions] = await Promise.all([
    countOf(listEvalDefs(id)),
    countOf(listGoldenCases(id)),
    countOf(listPolicyRules(orgId)),
    countOf(listGuardrailRules(orgId)),
    listPipelineVersions(id, orgId).catch(() => []),
  ]);

  const rules = (p.routing.rules ?? []).map((r) => ({
    label: r.value || r.attribute || r.name,
    action: r.action,
  }));

  return (
    <PipelineOverview
      pipeline={{
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        version: p.version,
        visibility: p.visibility,
        isTemplate: p.isTemplate,
        defaultModel: p.defaultModel,
        dataAllowlist: p.dataAllowlist,
        gateway: p.gateway ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        routing: {
          egressAllowed: p.routing.egressAllowed !== false,
          rules,
        },
        governance: {
          policyOverlayKeys: Object.keys(p.policyOverlay ?? {}).length,
          guardrailOverlayKeys: Object.keys(p.guardrailOverlay ?? {}).length,
          orgPolicyRules,
          orgGuardrailRules,
        },
        quality: { evalsAttached, goldenCases },
        recentVersions: versions.slice(0, 5).map((v) => ({
          id: v.id,
          version: v.version,
          note: v.note,
          createdAt: v.createdAt,
          createdBy: v.createdBy,
        })),
      }}
    />
  );
}

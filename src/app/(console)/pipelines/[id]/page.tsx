import { notFound } from 'next/navigation';
import { PipelineOverview } from '@/components/pipelines/PipelineOverview';
import { listAppsByPipeline } from '@/lib/apps-store';
import { listProjectsByPipeline } from '@/lib/chat';
import { listEvalDefs } from '@/lib/eval-defs';
import { listGoldenCases } from '@/lib/evals';
import { listGuardrailRules } from '@/lib/guardrails-rules';
import { getPipeline, listPipelineVersions } from '@/lib/pipelines';
import { listPolicyRules } from '@/lib/policy-rules';
import { getChatBindingGovernance } from '@/lib/store';
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

  const [
    evalsAttached,
    goldenCases,
    orgPolicyRules,
    orgGuardrailRules,
    versions,
    boundApps,
    boundProjects,
    chatGov,
  ] = await Promise.all([
    countOf(listEvalDefs(id)),
    countOf(listGoldenCases(id)),
    countOf(listPolicyRules(orgId)),
    countOf(listGuardrailRules(orgId)),
    listPipelineVersions(id, orgId).catch(() => []),
    listAppsByPipeline(id, orgId).catch(() => []),
    listProjectsByPipeline(id).catch(() => []),
    getChatBindingGovernance().catch(() => ({ defaultChatPipelineId: null, allowlist: [] as string[] })),
  ]);

  // Consumers of this pipeline (Overview "Consumers" section): apps/agents bound directly, chat
  // projects that pin it, and whether it's the org-default chat pipeline / in the available-for-chat
  // set. All honest — read from the real binding columns, never fabricated.
  const consumers = {
    apps: boundApps.map((a) => ({ id: a.id, title: a.title, published: a.published })),
    projects: boundProjects.map((pr) => ({ id: pr.id, name: pr.name })),
    isOrgDefaultChat: chatGov.defaultChatPipelineId === id,
    inChatAllowlist: (chatGov.allowlist ?? []).includes(id),
  };

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
        consumers,
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

import { notFound } from 'next/navigation';
import { GovernancePanel } from '@/components/pipelines/governance/GovernancePanel';
import {
  ORG_POLICY_DEFAULTS,
  describeEffective,
  normalizeOverlay,
} from '@/lib/pipeline-governance';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Pipeline POLICY tab — EFFECTIVE governance (org defaults + this pipeline's policyOverlay) ─────
// The pure describeEffective() merges the org policy baseline with this pipeline's overlay under the
// locked→tighten-only rule and decorates every control with its source. The operator edits the
// overlay here (tighten a control) → persists via updatePipeline (versions the pipeline). Scoped to
// THIS pipeline — the org store is where the baseline lives, never here.
export default async function PipelinePolicyPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();

  const overlay = normalizeOverlay(p.policyOverlay, ORG_POLICY_DEFAULTS);
  const view = describeEffective(ORG_POLICY_DEFAULTS, overlay);

  return (
    <GovernancePanel
      pipelineId={p.id}
      pipelineName={p.name}
      overlayField="policyOverlay"
      title="Policy"
      intro={`The effective ABAC policy for ${p.name}: your org defaults, with this pipeline's overrides on top. A control the org locked can only be tightened here, never loosened — every request through this pipeline is checked against the effective value below.`}
      orgDefaults={ORG_POLICY_DEFAULTS}
      overlay={overlay}
      view={view}
    />
  );
}

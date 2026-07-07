import { notFound } from 'next/navigation';
import { TabPlaceholder } from '@/components/pipelines/TabPlaceholder';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Policy tab — the pipeline's ABAC policy overlay. Inherits org defaults; may only TIGHTEN a
// locked org control (effectiveGovernance in pipelines-policy.ts). The overlay editor + effective-
// governance view land in the governance fan-out phase.
export default async function PipelinePolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  const keys = Object.keys(p.policyOverlay ?? {});
  return (
    <TabPlaceholder title="Policy overlay" pipelineName={p.name}>
      <p>
        This pipeline&apos;s ABAC policy overlay inherits the org defaults and may only tighten a
        locked control, never loosen it. The effective-governance view + overlay editor land in the
        governance fan-out.
      </p>
      <p className="mt-3">
        Overlay controls set: {keys.length === 0 ? 'none (inherits org defaults)' : keys.join(', ')}.
      </p>
    </TabPlaceholder>
  );
}

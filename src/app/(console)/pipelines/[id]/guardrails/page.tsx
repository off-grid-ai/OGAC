import { notFound } from 'next/navigation';
import { TabPlaceholder } from '@/components/pipelines/TabPlaceholder';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Guardrails tab — the pipeline's guardrail overlay (PII masking, injection, grounding), scoped
// to it and inheriting org defaults. The overlay editor lands in the governance fan-out phase.
export default async function PipelineGuardrailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  const keys = Object.keys(p.guardrailOverlay ?? {});
  return (
    <TabPlaceholder title="Guardrails overlay" pipelineName={p.name}>
      <p>
        PII masking, prompt-injection defence, and grounding checks scoped to this pipeline. Inherits
        org defaults and may only tighten locked controls. The overlay editor lands in the governance
        fan-out.
      </p>
      <p className="mt-3">
        Overlay controls set: {keys.length === 0 ? 'none (inherits org defaults)' : keys.join(', ')}.
      </p>
    </TabPlaceholder>
  );
}

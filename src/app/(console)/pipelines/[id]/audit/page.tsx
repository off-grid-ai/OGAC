import { notFound } from 'next/navigation';
import { TabPlaceholder } from '@/components/pipelines/TabPlaceholder';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Audit tab — every governed decision (policy/guardrail/egress) this pipeline made, plus who
// invoked it. A lens over the pipeline's audit events, filled in the telemetry fan-out phase.
export default async function PipelineAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  return (
    <TabPlaceholder title="Audit" pipelineName={p.name}>
      <p>
        Every governed decision this pipeline made — policy allow/deny, guardrail masking, egress
        leash — plus who invoked it. Filtered from the audit stream by pipeline id in the telemetry
        fan-out.
      </p>
    </TabPlaceholder>
  );
}

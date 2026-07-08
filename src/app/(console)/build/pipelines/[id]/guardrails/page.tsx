import { notFound } from 'next/navigation';
import { GovernancePanel } from '@/components/pipelines/governance/GovernancePanel';
import { GUARDRAIL_CATALOG } from '@/lib/guardrails-catalog';
import {
  ORG_GUARDRAIL_DEFAULTS,
  controlMeta,
  describeEffective,
  guardrailEntityToControl,
  normalizeOverlay,
} from '@/lib/pipeline-governance';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Pipeline GUARDRAILS tab — the guardrailOverlay, same locked→tighten-only semantics as Policy ──
// PII masking / prompt-injection / grounding / toxicity, scoped to THIS pipeline, inheriting the org
// guardrail baseline. The attach-from-library section maps a Presidio recognizer / Guardrails-AI
// validator (the shared catalog) to the pipeline control it tightens on — writing through the
// pipeline's guardrailOverlay, not the org guardrail store.
export default async function PipelineGuardrailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();

  const overlay = normalizeOverlay(p.guardrailOverlay, ORG_GUARDRAIL_DEFAULTS);
  const view = describeEffective(ORG_GUARDRAIL_DEFAULTS, overlay);

  // Build the attach-from-catalog list: one representative catalog item per managed control, so the
  // operator sees "turn on injection defence (Guardrails-AI)" etc. De-dupe by the control key it maps
  // to — a control already turned on in the effective view is dropped (nothing to attach).
  const activeKeys = new Set(view.controls.filter((c) => c.bool === true).map((c) => c.key));
  const seen = new Set<string>();
  const library = GUARDRAIL_CATALOG.filter((item) => item.defaultEnabled)
    .map((item) => {
      const mapped = guardrailEntityToControl(item.entity);
      return { item, mapped };
    })
    .filter(({ mapped }) => !activeKeys.has(mapped.key) && !seen.has(mapped.key) && seen.add(mapped.key))
    .map(({ item, mapped }) => ({
      id: item.id,
      name: `Turn on: ${controlMeta(mapped.key).label}`,
      description: `${item.name} — ${item.description}`,
      control: { key: mapped.key, ...mapped.value },
    }));

  return (
    <GovernancePanel
      pipelineId={p.id}
      pipelineName={p.name}
      overlayField="guardrailOverlay"
      title="Guardrails"
      intro={`PII masking, prompt-injection defence, grounding and toxicity filters for ${p.name}. These inherit your org guardrail baseline; a locked control can only be tightened here. Retrieved data and model output pass through the effective guardrails below on every call.`}
      orgDefaults={ORG_GUARDRAIL_DEFAULTS}
      overlay={overlay}
      view={view}
      library={library}
    />
  );
}

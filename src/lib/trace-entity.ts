// Resolve an observability entity (kind + id) into its Langfuse trace `EntityMatch`, enforcing
// org-scoped existence. This is the ONE place both per-entity observability routes (list + trace
// detail) turn a `?entity=&kind=` pair into a match, so attribution + the tenant check can't drift
// between them (DRY). Thin I/O over the pure match-builders; the shaping itself stays pure.
import type { EntityMatch } from '@/lib/observability-entity';
import { pipelineTraceMatch } from '@/lib/pipeline-api-key-format';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export type EntityKind = 'pipeline';

// Only `pipeline` is wired today (matched by its canonical `pipeline:<id>` tag). App/agent kinds will
// slot in here once their observe surfaces derive a normalized-run-id set. Returns null when the
// entity doesn't exist in the caller's org (→ 404) so one tenant can't read another's traces.
export async function resolveEntityMatch(
  kind: string,
  entity: string,
): Promise<EntityMatch | null> {
  if (kind !== 'pipeline') return null;
  const p = await getPipeline(entity, await currentOrgId()).catch(() => null);
  if (!p) return null;
  return pipelineTraceMatch(entity);
}

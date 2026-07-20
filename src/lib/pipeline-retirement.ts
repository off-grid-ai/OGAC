import { listPipelineConsumers, type PipelineConsumer } from '@/lib/pipeline-consumers';
import { deletePipeline } from '@/lib/pipelines';

export type PipelineDeleteResult =
  | { ok: true; deleted: true; consumers: [] }
  | { ok: false; deleted: false; reason: 'in_use'; consumers: PipelineConsumer[] }
  | { ok: false; deleted: false; reason: 'not_found'; consumers: [] };

/** Delete only after every consumer has been explicitly rebound or removed. */
export async function deleteUnusedPipeline(
  pipelineId: string,
  orgId: string,
): Promise<PipelineDeleteResult> {
  const consumers = await listPipelineConsumers(pipelineId, orgId);
  if (consumers.length > 0) return { ok: false, deleted: false, reason: 'in_use', consumers };
  const deleted = await deletePipeline(pipelineId, orgId);
  return deleted
    ? { ok: true, deleted: true, consumers: [] }
    : { ok: false, deleted: false, reason: 'not_found', consumers: [] };
}

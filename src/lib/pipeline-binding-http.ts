import { PipelineBindingError } from '@/lib/pipeline-run-glue';

export interface PipelineBindingHttpFailure {
  status: 409 | 503;
  body: {
    error: 'pipeline binding unavailable';
    code: string;
    reason: string;
  };
}

/** One HTTP projection for every App ingress. Unknown errors remain owned by the caller. */
export function pipelineBindingHttpFailure(error: unknown): PipelineBindingHttpFailure | null {
  if (!(error instanceof PipelineBindingError)) return null;
  return {
    status: error.binding.state === 'unavailable' ? 503 : 409,
    body: {
      error: 'pipeline binding unavailable',
      code: error.binding.code,
      reason: error.binding.reason,
    },
  };
}

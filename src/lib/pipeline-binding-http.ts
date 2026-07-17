import { PipelineBindingError } from '@/lib/pipeline-run-glue';

export interface PipelineBindingHttpFailure {
  status: 409 | 503;
  body: {
    error: 'pipeline binding unavailable';
    code: string;
    reason: string;
    pipelineId: string | null;
    nextAction: string;
  };
  audit: {
    action: 'trigger.denied';
    resource: string;
    outcome: 'blocked';
  };
}

export interface IngressBindingContext {
  ingress: string;
  target: string;
}

function nextAction(code: string): string {
  switch (code) {
    case 'binding_changed':
      return 'Reload the consumer and retry with its current pipeline binding.';
    case 'pipeline_unavailable':
      return 'Bind this consumer to a published pipeline, or explicitly remove its binding.';
    case 'resolver_unavailable':
      return 'Restore the control-plane database, then retry; execution was not started.';
    case 'agent_not_found':
      return 'Choose an enabled agent in this tenant and update the trigger target.';
    default:
      return 'Review the consumer pipeline binding before retrying.';
  }
}

/** One actionable HTTP + audit projection for every webhook/email App or agent ingress. */
export function pipelineBindingHttpFailure(
  error: unknown,
  context: IngressBindingContext = { ingress: 'ingress:unknown', target: 'consumer:unknown' },
): PipelineBindingHttpFailure | null {
  if (!(error instanceof PipelineBindingError)) return null;
  return {
    status: error.binding.state === 'unavailable' ? 503 : 409,
    body: {
      error: 'pipeline binding unavailable',
      code: error.binding.code,
      reason: error.binding.reason,
      pipelineId: error.binding.pipelineId,
      nextAction: nextAction(error.binding.code),
    },
    audit: {
      action: 'trigger.denied',
      resource: `${context.ingress} ${context.target} pipeline-binding:${error.binding.code}`,
      outcome: 'blocked',
    },
  };
}

/**
 * Temporal Schedule action arguments are static, but every workflow execution has a unique
 * Temporal run id. Replace only schedule-marked inputs with an execution-specific correlation id;
 * ordinary direct submissions retain their caller-minted id for idempotency.
 */
export function runInputForExecution<T extends { runId: string; scheduled?: boolean }>(
  input: T,
  temporalRunId: string,
): T {
  if (!input.scheduled) return input;
  const fire = temporalRunId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'fire';
  return { ...input, runId: `${input.runId}_${fire}` };
}

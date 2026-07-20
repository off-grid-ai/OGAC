// One timeout contract for every Console call into the on-prem guardrail plane.
// The fleet aggregator uses the same OFFGRID_GUARD_TIMEOUT_MS environment variable.

export const DEFAULT_GUARDRAIL_TIMEOUT_MS = 60_000;
export const GUARDRAIL_TIMEOUT_HEADROOM_MS = 5_000;

export function guardrailTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GUARDRAIL_TIMEOUT_MS;
}

export const GUARDRAIL_REQUEST_TIMEOUT_MS = guardrailTimeoutMs(
  process.env.OFFGRID_GUARD_TIMEOUT_MS,
);
export const GUARDRAIL_SCREEN_TIMEOUT_MS =
  GUARDRAIL_REQUEST_TIMEOUT_MS + GUARDRAIL_TIMEOUT_HEADROOM_MS;

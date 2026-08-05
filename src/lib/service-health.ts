/**
 * Browser-safe health result returned by the authenticated service-health API.
 *
 * `unverified` = something answered the probe, but not in a way that proves THIS service works — a 404
 * at the probe path means the path is wrong, so all we learned is that some HTTP server responded.
 * Kept as its own state because collapsing it into `up` is how three services on the fleet read healthy
 * while nothing was actually checking them (2026-08-05).
 */
export type HealthStatus = 'up' | 'down' | 'embedded' | 'optional' | 'unverified';

export interface ServiceHealth {
  id: string;
  status: HealthStatus;
  httpStatus: number | null;
  ms: number | null;
  error?: string;
  /** Human label for the current state — e.g. the fallback name for an optional service. */
  detail?: string;
}

/**
 * Embedded and optional/fallback services are operational; only a real outage is unhealthy.
 *
 * `unverified` counts as NOT unhealthy — something is serving — but callers that report a headline
 * "N/N healthy" should use `isProvenHealthy` instead, because an unverified service has not earned a
 * place in that numerator.
 */
export function isHealthy(status: HealthStatus): boolean {
  return status !== 'down';
}

/**
 * Did the probe actually PROVE this service works?
 *
 * Narrower than `isHealthy` on purpose. `optional` (an absent dependency on its fallback) and
 * `unverified` (something answered, but not provably this service) are both excluded — an absent
 * guardrail service must never count toward a green "everything is healthy" claim.
 */
export function isProvenHealthy(status: HealthStatus): boolean {
  return status === 'up' || status === 'embedded';
}

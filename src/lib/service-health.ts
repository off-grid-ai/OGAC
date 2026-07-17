/** Browser-safe health result returned by the authenticated service-health API. */
export type HealthStatus = 'up' | 'down' | 'embedded' | 'optional';

export interface ServiceHealth {
  id: string;
  status: HealthStatus;
  httpStatus: number | null;
  ms: number | null;
  error?: string;
  /** Human label for the current state — e.g. the fallback name for an optional service. */
  detail?: string;
}

/** Embedded and optional/fallback services are operational; only a real outage is unhealthy. */
export function isHealthy(status: HealthStatus): boolean {
  return status !== 'down';
}

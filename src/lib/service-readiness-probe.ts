// PURE (zero-IO): map a live service-health probe result (from status.ts `computeStatus`) into the
// deployment-readiness gates the service inventory renders (deployed / reachable / functional).
//
// This is the seam that makes the Service capability map's list-level readiness badge reflect REAL
// live health instead of a permanent "unverified". It deliberately only sets the three gates a
// health probe can honestly attest; `seeded` and `console-used` are workflow facts a liveness check
// cannot prove, so they are left to other evidence (never fabricated here).
import type { ReadinessEvidence, ReadinessState } from './service-topology';

/** The health verdict shape produced per service by `computeStatus()` in status.ts. */
export type ProbeHealthStatus = 'up' | 'down' | 'embedded' | 'optional';

export interface ServiceHealthResult {
  id: string;
  status: ProbeHealthStatus;
  ms?: number;
}

const SOURCE = 'live health probe (/api/v1/status)';

// Honest per-status mapping. `up` = the health endpoint answered < 500; `down` = configured but
// unreachable/5xx; `embedded` = runs in-process (no network hop to reach); `optional` = an optional
// dependency on its fallback / not network-asserted, so genuinely unknown.
function gatesFor(status: ProbeHealthStatus): Record<'deployed' | 'reachable' | 'functional', ReadinessState> {
  switch (status) {
    case 'up':
      return { deployed: 'pass', reachable: 'pass', functional: 'pass' };
    case 'embedded':
      // In-process backend: it is deployed + functional because the console it runs inside is
      // serving this request; there is no separate network endpoint to "reach".
      return { deployed: 'pass', reachable: 'not-applicable', functional: 'pass' };
    case 'down':
      // Declared + configured, but the liveness probe failed — do not claim it is deployed.
      return { deployed: 'unknown', reachable: 'fail', functional: 'fail' };
    case 'optional':
      // Optional dependency not asserted by the probe — honestly unknown, never a pass.
      return { deployed: 'unknown', reachable: 'unknown', functional: 'unknown' };
  }
}

function summaryFor(gate: string, status: ProbeHealthStatus, ms?: number): string {
  const latency = typeof ms === 'number' ? ` (${ms}ms)` : '';
  switch (status) {
    case 'up':
      return `Live health probe returned healthy${latency}.`;
    case 'embedded':
      return 'Runs in-process inside the console (no separate network endpoint).';
    case 'down':
      return `Live health probe could not reach the service or it returned 5xx${latency}.`;
    case 'optional':
      return 'Optional dependency — not asserted by the liveness probe.';
  }
}

/**
 * Convert one service's live health verdict into readiness evidence for the three probe-attestable
 * gates. `observedAt` is injected (callers pass the probe timestamp) so this stays pure/deterministic.
 */
export function readinessFromHealth(result: ServiceHealthResult, observedAt: string): ReadinessEvidence[] {
  const gates = gatesFor(result.status);
  return (Object.keys(gates) as Array<keyof typeof gates>)
    .filter((gate) => gates[gate] !== 'not-applicable')
    .map((gate) => ({
      gate,
      state: gates[gate],
      summary: summaryFor(gate, result.status, result.ms),
      source: SOURCE,
      observedAt,
    }));
}

/**
 * Merge live evidence into a service's baseline readiness. Live evidence is AUTHORITATIVE for every
 * gate it covers, so it REPLACES the baseline for exactly those gates (aggregation treats `unknown`
 * as dominating `pass`, so appending would let a stale "unknown" bury a fresh pass). Gates the live
 * evidence doesn't touch keep their baseline. Pure.
 */
export function mergeReadinessEvidence(
  baseline: readonly ReadinessEvidence[],
  live: readonly ReadinessEvidence[],
): ReadinessEvidence[] {
  if (live.length === 0) return [...baseline];
  const liveGates = new Set(live.map((e) => e.gate));
  return [...baseline.filter((e) => !liveGates.has(e.gate)), ...live];
}

/**
 * `console-used` evidence: PASS only when the console has a proven production workflow THROUGH this
 * service (≥1 capability whose workflow gate is verified). This is evidence-backed (the capability
 * audits), never a liveness guess — services with no proven workflow keep the baseline `unknown`.
 * Returns [] when there is no proven workflow, so it never overwrites the honest baseline. Pure.
 */
export function consoleUsedEvidence(
  hasProvenWorkflow: boolean,
  observedAt: string,
): ReadinessEvidence[] {
  if (!hasProvenWorkflow) return [];
  return [
    {
      gate: 'console-used',
      state: 'pass',
      summary: 'A production workflow through this service is verified in the capability audit.',
      source: 'capability audit (verified workflow gate)',
      observedAt,
    },
  ];
}

/** Build a serviceId → readiness-evidence[] map from a batch of live health results. Pure. */
export function buildReadinessByService(
  results: readonly ServiceHealthResult[],
  observedAt: string,
): Map<string, ReadinessEvidence[]> {
  const byService = new Map<string, ReadinessEvidence[]>();
  for (const result of results) {
    if (!result.id) continue;
    byService.set(result.id, readinessFromHealth(result, observedAt));
  }
  return byService;
}

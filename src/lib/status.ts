import {
  getServices,
  needsNetworkProbe,
  resolveHealth,
  type RawProbe,
  type ServiceEntry,
  type ServiceHealth,
} from '@/lib/services-directory';

// Shared service-health probing — one place, used by both the authenticated Services page
// (/api/v1/services/health, with latency detail) and the public status API (/api/v1/status,
// up/down only). A gate that answers 401/302 still counts as UP (it's responding); only a
// 5xx or a network/timeout error counts as DOWN.
export async function probeService(url: string, healthPath?: string, timeoutMs = 5000): Promise<RawProbe> {
  const target = new URL(healthPath ?? '/', url).toString();
  const started = Date.now();
  try {
    const res = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - started;
    return { status: res.status >= 500 ? 'down' : 'up', httpStatus: res.status, ms };
  } catch (e) {
    return { status: 'down', httpStatus: null, ms: null, error: e instanceof Error ? e.message : 'unreachable' };
  }
}

// Only http(s) URLs can be HTTP-probed via fetch. An embedded (embedded://) or Redis (redis://)
// URL isn't — probing it would falsely read 'down'. For those we skip the network call and let
// the pure resolver report the honest embedded / optional-fallback state.
function isHttpProbeable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Probe a single service and resolve it to its honest health state (embedded / optional / up /
// down). Embedded backends and non-HTTP optional deps are never network-probed.
export async function probeEntry(entry: ServiceEntry): Promise<ServiceHealth> {
  if (!needsNetworkProbe(entry) || !isHttpProbeable(entry.url)) {
    return resolveHealth(entry);
  }
  const raw = await probeService(entry.url, entry.healthPath);
  return resolveHealth(entry, raw);
}

// Latency thresholds for the up/good vs up/degraded call (ms). A service answering slowly is
// "up" but "degraded". Overridable via env for tuning.
const SLOW_MS = Number(process.env.OFFGRID_STATUS_SLOW_MS ?? 1500);

export interface StatusEntry {
  id: string;
  label: string;
  // 'embedded' (in-process backend) and 'optional' (on documented fallback / alternative — incl.
  // canonical planes not deployed on this fleet) are healthy, not outages; only 'down' is a real
  // failure.
  status: 'up' | 'down' | 'embedded' | 'optional';
  performance: 'good' | 'degraded' | 'unknown'; // good/degraded when up (by latency); unknown otherwise
  ms: number | null;
}
export interface StatusSummary {
  // operational = all up & fast · degraded = something slow or partial · down = nothing up
  status: 'operational' | 'degraded' | 'down';
  up: number;
  total: number;
  services: StatusEntry[];
  checkedAt: string;
}

// Public, node-free status: each declared service's up/down + performance + an overall rollup.
export async function computeStatus(): Promise<StatusSummary> {
  const services: ServiceEntry[] = getServices();
  const results = await Promise.all(
    services.map(async (s): Promise<StatusEntry> => {
      const h = await probeEntry(s);
      const performance: StatusEntry['performance'] =
        h.status !== 'up' ? 'unknown' : (h.ms != null && h.ms > SLOW_MS ? 'degraded' : 'good');
      return { id: s.id, label: s.label, status: h.status, performance, ms: h.ms };
    }),
  );
  // Healthy = anything that isn't a real outage: up, embedded, or on its optional fallback.
  const healthy = results.filter((r) => r.status !== 'down').length;
  const total = results.length;
  const up = healthy;
  const anySlow = results.some((r) => r.status === 'up' && r.performance === 'degraded');
  const overall: StatusSummary['status'] =
    healthy === 0 ? 'down' : (healthy < total || anySlow) ? 'degraded' : 'operational';
  return { status: overall, up, total, services: results, checkedAt: new Date().toISOString() };
}

import { getServices, type ServiceEntry, type ServiceHealth } from '@/lib/services-directory';

// Shared service-health probing — one place, used by both the authenticated Services page
// (/api/v1/services/health, with latency detail) and the public status API (/api/v1/status,
// up/down only). A gate that answers 401/302 still counts as UP (it's responding); only a
// 5xx or a network/timeout error counts as DOWN.
export async function probeService(url: string, healthPath?: string, timeoutMs = 5000): Promise<Omit<ServiceHealth, 'id'>> {
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

// Latency thresholds for the up/good vs up/degraded call (ms). A service answering slowly is
// "up" but "degraded". Overridable via env for tuning.
const SLOW_MS = Number(process.env.OFFGRID_STATUS_SLOW_MS ?? 1500);

export interface StatusEntry {
  id: string;
  label: string;
  status: 'up' | 'down';
  performance: 'good' | 'degraded' | 'unknown'; // good/degraded when up (by latency); unknown when down
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
      const h = await probeService(s.url, s.healthPath);
      const performance: StatusEntry['performance'] =
        h.status !== 'up' ? 'unknown' : (h.ms != null && h.ms > SLOW_MS ? 'degraded' : 'good');
      return { id: s.id, label: s.label, status: h.status, performance, ms: h.ms };
    }),
  );
  const up = results.filter((r) => r.status === 'up').length;
  const total = results.length;
  const anySlow = results.some((r) => r.status === 'up' && r.performance === 'degraded');
  const overall: StatusSummary['status'] =
    up === 0 ? 'down' : (up < total || anySlow) ? 'degraded' : 'operational';
  return { status: overall, up, total, services: results, checkedAt: new Date().toISOString() };
}

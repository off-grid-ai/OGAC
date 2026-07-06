import { getServices, type ServiceHealth } from '@/lib/services-directory';
import { probeEntry } from '@/lib/status';

// Server-side health sweep of the whole suite (authenticated Services page) — probes each
// surface through the real edge path and returns latency detail. Shares the probe with the
// public /api/v1/status API (see src/lib/status.ts) so both agree. Embedded backends (LanceDB)
// and optional deps (Redis) resolve to their honest state without a meaningless network probe.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const services = getServices();
  const results: ServiceHealth[] = await Promise.all(services.map((s) => probeEntry(s)));
  return Response.json({ services: results, checkedAt: new Date().toISOString() });
}

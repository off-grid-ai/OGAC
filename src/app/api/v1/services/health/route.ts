import { getServices, type ServiceHealth } from '@/lib/services-directory';
import { probeService } from '@/lib/status';

// Server-side health sweep of the whole suite (authenticated Services page) — probes each
// surface through the real edge path and returns latency detail. Shares the probe with the
// public /api/v1/status API (see src/lib/status.ts) so both agree on up/down.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const services = getServices();
  const results: ServiceHealth[] = await Promise.all(
    services.map(async (s) => ({ id: s.id, ...(await probeService(s.url, s.healthPath)) })),
  );
  return Response.json({ services: results, checkedAt: new Date().toISOString() });
}

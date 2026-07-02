import { getServices, type ServiceHealth } from '@/lib/services-directory';

// Server-side health sweep of the whole suite — probes each public surface through the
// real edge path (Cloudflare tunnel + Caddy), so "up" means users can actually reach it.
// A gate that answers 401/302 still counts as up (the service is responding); only a
// 5xx or a network/timeout error counts as down.
export const dynamic = 'force-dynamic';

async function probe(url: string, healthPath: string | undefined): Promise<Omit<ServiceHealth, 'id'>> {
  const target = new URL(healthPath ?? '/', url).toString();
  const started = Date.now();
  try {
    const res = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const ms = Date.now() - started;
    return { status: res.status >= 500 ? 'down' : 'up', httpStatus: res.status, ms };
  } catch (e) {
    return { status: 'down', httpStatus: null, ms: null, error: e instanceof Error ? e.message : 'unreachable' };
  }
}

export async function GET(): Promise<Response> {
  const services = getServices();
  const results: ServiceHealth[] = await Promise.all(
    services.map(async (s) => ({ id: s.id, ...(await probe(s.url, s.healthPath)) })),
  );
  return Response.json({ services: results, checkedAt: new Date().toISOString() });
}

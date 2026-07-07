import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { cloudProviderStatuses } from '@/lib/cloud-providers';
import { getOrgPolicy } from '@/lib/store';

export const dynamic = 'force-dynamic';

// ── GET /api/v1/gateway/providers ───────────────────────────────────────────────
// Honest status of the CLOUD egress providers wired behind the routing framework. A cloud model is
// only genuinely available when (a) a provider is configured (base URL + API key in env) AND (b) the
// org egress switch is ON — a cloud route with egress off is leashed to block regardless. This route
// reports both truths so the console never shows a cloud model as usable when it isn't. It NEVER
// returns API keys — only presence + base URL + the model prefixes that route to each provider.
//
// Reachability is probed best-effort: a HEAD/GET to the provider base URL. Unreachable ⇒ 'down'
// (mirrors the Services honest-health pattern) but a configured+unreachable provider is still shown
// as configured, so the operator sees "wired but not answering" rather than a silent hide.
async function probe(baseUrl: string): Promise<{ reachable: boolean; status: number }> {
  try {
    // /models is the cheapest OpenAI-compatible liveness signal; auth may 401 — that still proves the
    // endpoint answers (reachable). Only a transport failure / timeout is 'down'.
    const r = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(2500),
    });
    return { reachable: true, status: r.status };
  } catch {
    return { reachable: false, status: 0 };
  }
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const [statuses, policy] = await Promise.all([
    Promise.resolve(cloudProviderStatuses(process.env as Record<string, string | undefined>)),
    getOrgPolicy().catch(() => ({ egressAllowed: false })),
  ]);

  const providers = await Promise.all(
    statuses.map(async (s) => {
      // Only probe configured providers — an unconfigured one has no meaningful endpoint to reach.
      const health = s.configured ? await probe(s.baseUrl) : { reachable: false, status: 0 };
      return {
        ...s,
        // A configured provider that answers = 'up'; configured but no answer = 'down';
        // not configured = 'unconfigured' (not an outage — it was never wired).
        health: !s.configured ? 'unconfigured' : health.reachable ? 'up' : 'down',
        probeStatus: health.status,
        // Genuinely usable ONLY when configured AND reachable AND org egress is ON.
        available: s.configured && health.reachable && policy.egressAllowed === true,
      };
    }),
  );

  return NextResponse.json({
    egressAllowed: policy.egressAllowed === true,
    providers,
  });
}

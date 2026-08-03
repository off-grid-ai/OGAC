import { NextResponse, type NextRequest } from 'next/server';
import { opensearchFetch } from '@/lib/opensearch-http';
import { classifySinkStatus, sinkUnreachable } from '@/lib/sink-unavailable';
import { requireUser } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Common prompts — mines the gateway's durable call history (OpenSearch index `offgrid-gateway`,
// where the observability sink ships every call) for the prompt texts users actually send, then
// normalizes + counts them to surface the org's most frequently-used prompts. These can be saved
// into the personal/org prompt library. Falls back to available:false when OpenSearch is
// unreachable so the UI degrades gracefully (mirrors /gateway/logs).
const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

const MAX_LEN = 500;

// Normalize a prompt for counting: trim, collapse whitespace, lowercase, cap length.
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_LEN);
}

// eslint-disable-next-line complexity
export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const body = {
    size: 1000,
    _source: ['input', '@timestamp'],
    sort: [{ '@timestamp': 'desc' }],
    query: { bool: { must: [{ exists: { field: 'input' } }] } },
  };

  try {
    // Same raw-unauthenticated-fetch bug as the gateway logs route: with auth on, this 401s and the
    // surface silently shows nothing. Both go through the brokered helper now.
    const r = await opensearchFetch(`/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      timeoutMs: 6000,
    });
    if (!r.ok) {
      return NextResponse.json(classifySinkStatus(r.status, 'The prompt history'), { status: 200 });
    }
    const data = await r.json();
    const hits: { _source: { input?: unknown; '@timestamp'?: string } }[] = data?.hits?.hits ?? [];

    // Count normalized prompts; keep one representative original + the most recent timestamp.
    const agg = new Map<string, { prompt: string; count: number; lastSeen: string }>();
    for (const h of hits) {
      const raw = typeof h._source?.input === 'string' ? h._source.input : '';
      const key = normalize(raw);
      if (!key) continue;
      const ts = h._source?.['@timestamp'] ?? '';
      const cur = agg.get(key);
      if (cur) {
        cur.count += 1;
        if (ts > cur.lastSeen) cur.lastSeen = ts;
      } else {
        agg.set(key, { prompt: raw.trim().slice(0, MAX_LEN), count: 1, lastSeen: ts });
      }
    }

    const common = [...agg.values()].sort((a, b) => b.count - a.count).slice(0, 25);
    return NextResponse.json({ available: true, common });
  } catch {
    return NextResponse.json(sinkUnreachable('The prompt history'), { status: 200 });
  }
}

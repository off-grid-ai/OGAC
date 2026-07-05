import { createInspector, project2DFromPoints, type VectorDBConfig, type VectorDBKind } from '@offgrid/vectordb';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Action = 'ping' | 'collections' | 'sample';
interface Body {
  kind?: VectorDBKind;
  url?: string;
  apiKey?: string;
  collection?: string;
  action?: Action;
  n?: number;
}

// A short, safe preview of a point's payload for the scatter-plot side panel.
function payloadPreview(payload?: Record<string, unknown>): string {
  if (!payload) return '';
  try {
    const s = JSON.stringify(payload);
    return s.length > 240 ? `${s.slice(0, 240)}…` : s;
  } catch {
    return '';
  }
}

// Server-side vector-DB inspector: create an inspector from the request (or env defaults) and
// dispatch to ping / list-collections / sample. Always fail-open with { error } — never throw —
// so the console panel can degrade gracefully when a store is unreachable.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    /* empty body → env defaults */
  }

  const kind = body.kind ?? 'qdrant';
  const url = body.url ?? process.env.OFFGRID_QDRANT_URL ?? 'http://offgrid-s1.local:6333';
  const apiKey = body.apiKey ?? process.env.OFFGRID_QDRANT_API_KEY;
  const action = body.action ?? 'ping';
  const cfg: VectorDBConfig = { apiKey, collection: body.collection, kind, url };

  try {
    const inspector = createInspector(cfg);

    if (action === 'ping') {
      const ok = await inspector.ping();
      return NextResponse.json({ ok });
    }

    if (action === 'collections') {
      const collections = await inspector.listCollections();
      return NextResponse.json({ collections });
    }

    if (action === 'sample') {
      const name = body.collection;
      if (!name) return NextResponse.json({ error: 'collection required' });
      const raw = await inspector.sample(name, body.n ?? 64);
      const projected = project2DFromPoints(raw);
      const byId = new Map(raw.map((p) => [String(p.id), p.payload]));
      const points = projected.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        payloadPreview: payloadPreview(p.payload ?? byId.get(String(p.id))),
      }));
      return NextResponse.json({ points, count: points.length });
    }

    return NextResponse.json({ error: `unknown action: ${String(action)}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'inspector failed' });
  }
}

// @offgrid/vectordb — Qdrant adapter
//
// Real Qdrant REST calls using the global `fetch`. All methods fail open:
// on any network/parse error they return empty/null and never throw, so a UI
// can probe an unknown endpoint safely.

import type { VectorStoreInspector } from '../inspector.js';
import type { CollectionInfo, VectorDBConfig, VectorPoint } from '../types.js';

/** Strip a single trailing slash so URL joins are clean. */
function baseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Build request headers, adding the `api-key` header when configured. */
function headers(cfg: VectorDBConfig): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) h['api-key'] = cfg.apiKey;
  return h;
}

/** GET JSON, returning null on any failure. */
async function getJson(url: string, cfg: VectorDBConfig): Promise<unknown> {
  try {
    const res = await fetch(url, { method: 'GET', headers: headers(cfg) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** POST JSON, returning null on any failure. */
async function postJson(
  url: string,
  cfg: VectorDBConfig,
  body: unknown,
): Promise<unknown> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Parse a Qdrant `GET /collections/{name}` response into CollectionInfo.
 * Qdrant's vector config can be a single unnamed config or a named map;
 * we read the first size/distance we can find.
 */
function parseCollectionInfo(name: string, raw: unknown): CollectionInfo | null {
  const result = (raw as { result?: unknown } | null)?.result;
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;

  let vectors = 0;
  const vc = r['vectors_count'];
  const pc = r['points_count'];
  if (typeof vc === 'number') vectors = vc;
  else if (typeof pc === 'number') vectors = pc;

  let dim: number | undefined;
  let distance: string | undefined;

  const config = r['config'] as Record<string, unknown> | undefined;
  const params = config?.['params'] as Record<string, unknown> | undefined;
  const vectorsCfg = params?.['vectors'];
  if (vectorsCfg && typeof vectorsCfg === 'object') {
    const asObj = vectorsCfg as Record<string, unknown>;
    // Single unnamed vector config: { size, distance }
    if (typeof asObj['size'] === 'number') {
      dim = asObj['size'] as number;
      if (typeof asObj['distance'] === 'string') distance = asObj['distance'] as string;
    } else {
      // Named vectors: { name: { size, distance }, ... } — take the first.
      const first = Object.values(asObj)[0] as Record<string, unknown> | undefined;
      if (first && typeof first['size'] === 'number') {
        dim = first['size'] as number;
        if (typeof first['distance'] === 'string') distance = first['distance'] as string;
      }
    }
  }

  return { name, vectors, dim, distance };
}

/** Map a raw Qdrant scroll/search point into a VectorPoint. */
function parsePoint(raw: unknown): VectorPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = p['id'];
  if (typeof id !== 'string' && typeof id !== 'number') return null;

  const point: VectorPoint = { id };

  const vec = p['vector'];
  if (Array.isArray(vec) && vec.every((v) => typeof v === 'number')) {
    point.vector = vec as number[];
  } else if (vec && typeof vec === 'object') {
    // Named vectors — take the first numeric array we find.
    const first = Object.values(vec as Record<string, unknown>).find(
      (v) => Array.isArray(v) && v.every((n) => typeof n === 'number'),
    );
    if (Array.isArray(first)) point.vector = first as number[];
  }

  const payload = p['payload'];
  if (payload && typeof payload === 'object') {
    point.payload = payload as Record<string, unknown>;
  }

  return point;
}

export function qdrantInspector(cfg: VectorDBConfig): VectorStoreInspector {
  const url = baseUrl(cfg.url);

  return {
    config: cfg,

    async ping(): Promise<boolean> {
      // Qdrant root returns a small JSON banner; /healthz returns plain text.
      const root = await getJson(`${url}/`, cfg);
      if (root !== null) return true;
      try {
        const res = await fetch(`${url}/healthz`, { headers: headers(cfg) });
        return res.ok;
      } catch {
        return false;
      }
    },

    async listCollections(): Promise<CollectionInfo[]> {
      const raw = await getJson(`${url}/collections`, cfg);
      const cols = (raw as { result?: { collections?: unknown } } | null)?.result
        ?.collections;
      if (!Array.isArray(cols)) return [];

      const names = cols
        .map((c) => (c as { name?: unknown })?.name)
        .filter((n): n is string => typeof n === 'string');

      // Enrich each with dim/distance/count where possible.
      const infos = await Promise.all(
        names.map(async (name) => {
          const detail = await getJson(`${url}/collections/${encodeURIComponent(name)}`, cfg);
          return parseCollectionInfo(name, detail) ?? { name, vectors: 0 };
        }),
      );
      return infos;
    },

    async collectionInfo(name: string): Promise<CollectionInfo | null> {
      const raw = await getJson(`${url}/collections/${encodeURIComponent(name)}`, cfg);
      return parseCollectionInfo(name, raw);
    },

    async sample(name: string, n = 20): Promise<VectorPoint[]> {
      const raw = await postJson(
        `${url}/collections/${encodeURIComponent(name)}/points/scroll`,
        cfg,
        { limit: n, with_vector: true, with_payload: true },
      );
      const points = (raw as { result?: { points?: unknown } } | null)?.result?.points;
      if (!Array.isArray(points)) return [];
      return points.map(parsePoint).filter((p): p is VectorPoint => p !== null);
    },

    async count(name: string): Promise<number> {
      const info = await this.collectionInfo(name);
      return info?.vectors ?? 0;
    },

    async search(name: string, vector: number[], k = 10): Promise<VectorPoint[]> {
      const raw = await postJson(
        `${url}/collections/${encodeURIComponent(name)}/points/search`,
        cfg,
        { vector, limit: k, with_payload: true, with_vector: true },
      );
      const result = (raw as { result?: unknown } | null)?.result;
      if (!Array.isArray(result)) return [];
      return result.map(parsePoint).filter((p): p is VectorPoint => p !== null);
    },
  };
}

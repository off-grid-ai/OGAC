// Retrieval / vector-store read-back (Qdrant). Two layers, SOLID seam:
//   1. A PURE normalizer (zero I/O, zero @/ imports) that turns raw Qdrant JSON into a display
//      model. It never throws — every malformed shape degrades to a safe default. Unit-tested in
//      isolation (test/retrieval-view.test.ts), mirroring tenancy-policy.ts.
//   2. A thin best-effort reader that hits Qdrant's HTTP API and feeds the raw JSON to the
//      normalizer. It never throws either — failure comes back as { data: null, error }.
//
// The active retrieval adapter is selected exactly like the registry's pick(): the first entry
// by default, overridable via OFFGRID_ADAPTER_RETRIEVAL. We re-derive that here (from a small
// inlined list) rather than importing the registry, to keep this module import-free and pure.

// ── Display model ────────────────────────────────────────────────────────────

export type CollectionStatus = 'green' | 'yellow' | 'red' | 'grey' | 'unknown';

export interface CollectionView {
  name: string;
  vectorsCount: number;
  pointsCount: number;
  status: CollectionStatus;
}

export interface RetrievalView {
  /** Active retrieval adapter id (e.g. 'qdrant', 'lancedb', 'pgvector'). */
  adapterId: string;
  /** Whether the active adapter is the dedicated Qdrant vector DB. */
  isQdrant: boolean;
  /** Configured Qdrant base URL, if any. */
  url: string | null;
  /** Whether the vector store answered. */
  reachable: boolean;
  collections: CollectionView[];
  /** Sum of vectorsCount across all collections. */
  totalVectors: number;
}

// Retrieval adapter ids, in registry order — the first is the default (mirrors
// RETRIEVAL_ENTRIES in src/lib/adapters/services.ts). Kept inline to stay import-free.
export const RETRIEVAL_ADAPTER_IDS = ['lancedb', 'pgvector', 'qdrant'] as const;

/** Mirror of the registry's pick(): explicit override wins, else the first (default) id. */
export function activeRetrievalAdapter(override?: string | null): string {
  const wanted = typeof override === 'string' ? override.trim() : '';
  if (wanted && (RETRIEVAL_ADAPTER_IDS as readonly string[]).includes(wanted)) return wanted;
  return RETRIEVAL_ADAPTER_IDS[0];
}

// ── Pure normalizer ──────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function asStatus(v: unknown): CollectionStatus {
  return v === 'green' || v === 'yellow' || v === 'red' || v === 'grey' ? v : 'unknown';
}

export interface RawCollection {
  /** Raw entry from `GET /collections` → result.collections[] (has `name`). */
  name?: unknown;
  /** Raw body from `GET /collections/{name}` → result (has counts + status), if fetched. */
  detail?: unknown;
}

export interface NormalizeInput {
  adapterId: string;
  url?: string | null;
  reachable: boolean;
  /** Raw body of `GET /collections`, as parsed JSON (or null when unreachable). */
  collectionsBody?: unknown;
  /** Per-collection detail bodies keyed by collection name (raw `GET /collections/{name}`). */
  details?: Record<string, unknown>;
}

/**
 * Turn raw Qdrant responses into a RetrievalView. Never throws.
 */
export function normalizeRetrieval(input: NormalizeInput): RetrievalView {
  const adapterId = typeof input.adapterId === 'string' && input.adapterId ? input.adapterId : 'unknown';
  const url = typeof input.url === 'string' && input.url ? input.url : null;
  const details = asRecord(input.details) ?? {};

  const collections: CollectionView[] = [];
  const body = asRecord(input.collectionsBody);
  const result = asRecord(body?.result);
  const list = Array.isArray(result?.collections) ? (result!.collections as unknown[]) : [];

  for (const entry of list) {
    const rec = asRecord(entry);
    const name = rec && typeof rec.name === 'string' ? rec.name : null;
    if (!name) continue;
    const detail = asRecord(asRecord(details[name])?.result) ?? asRecord(details[name]);
    collections.push({
      name,
      vectorsCount: asCount(detail?.vectors_count),
      pointsCount: asCount(detail?.points_count),
      status: asStatus(detail?.status),
    });
  }

  collections.sort((a, b) => a.name.localeCompare(b.name));
  const totalVectors = collections.reduce((sum, c) => sum + c.vectorsCount, 0);

  return {
    adapterId,
    isQdrant: adapterId === 'qdrant',
    url,
    reachable: Boolean(input.reachable),
    collections,
    totalVectors,
  };
}

// ── Best-effort reader (thin I/O) ──────────────────────────────────────────────

export interface ReadResult {
  data: RetrievalView | null;
  error: string | null;
}

async function getJson(url: string, timeoutMs = 3000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Read the live vector store and produce a RetrievalView. Never throws → returns { data, error }.
 * When the active adapter is not Qdrant (or no URL is set) we still return a valid, unreachable
 * view describing the active adapter so the page can render it.
 */
export async function readRetrieval(env: NodeJS.ProcessEnv = process.env): Promise<ReadResult> {
  const adapterId = activeRetrievalAdapter(env.OFFGRID_ADAPTER_RETRIEVAL);
  const url = (env.OFFGRID_QDRANT_URL ?? '').replace(/\/+$/, '') || null;

  // Only Qdrant exposes the /collections HTTP surface we read here.
  if (adapterId !== 'qdrant' || !url) {
    return {
      data: normalizeRetrieval({ adapterId, url, reachable: false }),
      error: null,
    };
  }

  try {
    const collectionsBody = await getJson(`${url}/collections`);
    const body = asRecord(collectionsBody);
    const result = asRecord(body?.result);
    const list = Array.isArray(result?.collections) ? (result!.collections as unknown[]) : [];
    const names = list
      .map((e) => asRecord(e))
      .map((r) => (r && typeof r.name === 'string' ? r.name : null))
      .filter((n): n is string => Boolean(n));

    const details: Record<string, unknown> = {};
    await Promise.all(
      names.map(async (name) => {
        try {
          details[name] = await getJson(`${url}/collections/${encodeURIComponent(name)}`);
        } catch {
          // leave detail absent → counts default to 0, status 'unknown'
        }
      }),
    );

    return {
      data: normalizeRetrieval({ adapterId, url, reachable: true, collectionsBody, details }),
      error: null,
    };
  } catch (e) {
    return {
      data: normalizeRetrieval({ adapterId, url, reachable: false }),
      error: e instanceof Error ? e.message : 'unreachable',
    };
  }
}

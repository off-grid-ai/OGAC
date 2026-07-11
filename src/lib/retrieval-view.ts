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
  /**
   * Whether retrieval is served by the BUILT-IN embedded store (anything that isn't the external
   * Qdrant vector DB — e.g. lancedb, pgvector). This is a normal, fully-working state; the external
   * Qdrant collections API this inspector reads just isn't applicable, so a "0 vectors / unreachable"
   * reading is NOT an error. The UI should say so affirmatively.
   */
  usingEmbeddedStore: boolean;
  /** Configured Qdrant base URL, if any. */
  url: string | null;
  /** Whether the vector store answered. */
  reachable: boolean;
  collections: CollectionView[];
  /** Sum of vectorsCount across all collections. */
  totalVectors: number;
  /**
   * Human, operator-facing one-liner describing the current retrieval backing — affirmative for the
   * embedded store, count-based for a live Qdrant, and a plain hint when Qdrant is set but unreachable.
   */
  note: string;
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

  const isQdrant = adapterId === 'qdrant';
  const usingEmbeddedStore = !isQdrant;
  const reachable = Boolean(input.reachable);

  return {
    adapterId,
    isQdrant,
    usingEmbeddedStore,
    url,
    reachable,
    collections,
    totalVectors,
    note: retrievalNote({ adapterId, isQdrant, usingEmbeddedStore, reachable }),
  };
}

// PURE: the operator-facing one-liner for the current retrieval backing.
// - embedded store  → affirmative: it's serving retrieval; external vector DB is optional.
// - Qdrant reachable → the live-store framing (counts come from the collections list beside it).
// - Qdrant set but unreachable → a plain connectivity hint (this IS an error state).
export function retrievalNote(v: {
  adapterId: string;
  isQdrant: boolean;
  usingEmbeddedStore: boolean;
  reachable: boolean;
}): string {
  if (v.usingEmbeddedStore) {
    return `Retrieval is served by the built-in embedded store (${v.adapterId}). An external vector database (Qdrant) is optional — it is not configured, and that is not an error.`;
  }
  if (v.reachable) {
    return 'Retrieval is served by the external Qdrant vector database.';
  }
  return 'The external Qdrant vector database is configured but unreachable. Check OFFGRID_QDRANT_URL and that Qdrant is running.';
}

// ── Pure: collection-management request/response logic (zero I/O) ──────────────

/** Distance metrics Qdrant accepts, in the exact casing its API expects. */
export const QDRANT_DISTANCES = ['Cosine', 'Dot', 'Euclid'] as const;
export type QdrantDistance = (typeof QDRANT_DISTANCES)[number];

// Map the loose UI values (cosine/dot/euclid, any case) onto Qdrant's exact enum.
const DISTANCE_ALIASES: Record<string, QdrantDistance> = {
  cosine: 'Cosine',
  cos: 'Cosine',
  dot: 'Dot',
  dotproduct: 'Dot',
  euclid: 'Euclid',
  euclidean: 'Euclid',
  l2: 'Euclid',
};

export interface CreateCollectionInput {
  name?: unknown;
  vectorSize?: unknown;
  distance?: unknown;
}

export interface CreateCollectionPayload {
  vectors: { size: number; distance: QdrantDistance };
}

export interface BuildCreateResult {
  name: string | null;
  payload: CreateCollectionPayload | null;
  error: string | null;
}

// Qdrant collection names: keep them filesystem/URL-safe. Letters, digits, -, _, ., 1..255 chars.
const NAME_RE = /^[A-Za-z0-9._-]{1,255}$/;

/** Normalize a distance string to Qdrant's enum, or null if unrecognized. */
export function normalizeDistance(v: unknown): QdrantDistance | null {
  if (typeof v !== 'string') return null;
  const key = v.trim().toLowerCase();
  return DISTANCE_ALIASES[key] ?? null;
}

/** Validate a proposed collection name. Returns the trimmed name or null. */
export function normalizeCollectionName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.trim();
  return NAME_RE.test(name) ? name : null;
}

/**
 * PURE: validate create-collection input and build the Qdrant `PUT /collections/{name}` body.
 * Never throws — bad input comes back as { payload: null, error }.
 */
export function buildCreatePayload(input: CreateCollectionInput): BuildCreateResult {
  const name = normalizeCollectionName(input.name);
  if (!name) {
    return { name: null, payload: null, error: 'name must be 1–255 chars of letters, digits, . _ or -' };
  }
  const sizeRaw = input.vectorSize;
  let size = Number.NaN;
  if (typeof sizeRaw === 'number') size = sizeRaw;
  else if (typeof sizeRaw === 'string' && sizeRaw.trim() !== '') size = Number(sizeRaw);
  if (!Number.isInteger(size) || size < 1 || size > 65536) {
    return { name, payload: null, error: 'vectorSize must be an integer between 1 and 65536' };
  }
  const distance = normalizeDistance(input.distance);
  if (!distance) {
    return { name, payload: null, error: 'distance must be one of cosine, dot, euclid' };
  }
  return { name, payload: { vectors: { size, distance } }, error: null };
}

/** PURE: shape a Qdrant write response into a uniform { ok, error } result. Never throws. */
export function normalizeWriteResponse(status: number, body: unknown): { ok: boolean; error: string | null } {
  const rec = asRecord(body);
  const result = rec?.result;
  const ok = status >= 200 && status < 300 && result !== false;
  if (ok) return { ok: true, error: null };
  // Qdrant surfaces failures under status.error; fall back to a generic message.
  const statusRec = asRecord(rec?.status);
  const msg =
    (typeof statusRec?.error === 'string' && statusRec.error) ||
    (typeof rec?.error === 'string' && (rec.error as string)) ||
    `HTTP ${status}`;
  return { ok: false, error: msg };
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

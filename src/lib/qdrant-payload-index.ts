// ─── Payload indexes: making the filter we run on EVERY retrieval cheap ───────────────────────────────
//
// The capability map records this as under-leveraged: "payload-INDEX lifecycle management (create/drop
// payload indexes, index recommendations) is still not surfaced."
//
// It matters more than it sounds. Every governed retrieval filters on `org_id` — that is the tenant
// isolation boundary, applied to every query in `qdrant.ts` — and measured on the deployed collection
// (`offgrid-brain`, 2026-08-04) there were **no payload indexes at all**. Qdrant will happily answer an
// unindexed filter by scanning, which is invisible at three points and is the thing that falls over first
// as a tenant's corpus grows. The fix is one index on the field we always filter by.
//
// Pure. Zero IO. The adapter shell calls the Qdrant REST API and hands raw JSON to `parsePayloadIndexes`.

/** Qdrant payload schema types we know how to ask for. */
export type PayloadFieldType = 'keyword' | 'integer' | 'float' | 'bool' | 'text' | 'datetime' | 'uuid';

const VALID_TYPES: readonly PayloadFieldType[] = [
  'keyword',
  'integer',
  'float',
  'bool',
  'text',
  'datetime',
  'uuid',
];

export interface PayloadIndex {
  field: string;
  type: string;
  /** Points indexed, when the server reported it. */
  points?: number | null;
}

/**
 * The payload fields Off Grid's own retrieval filters on, and the type each needs.
 *
 * Derived from the real query builders in `qdrant.ts`, not aspirational: `org_id` is an exact-match tenant
 * filter (keyword) and `text` is a full-text match (text). Anything we do not filter on is deliberately
 * absent — an index costs memory and write time, so recommending one nobody queries is a cost with no
 * return.
 */
export const FILTERED_PAYLOAD_FIELDS: readonly { field: string; type: PayloadFieldType; why: string }[] = [
  {
    field: 'org_id',
    type: 'keyword',
    why: 'every governed retrieval filters by tenant — this is the isolation boundary, applied on every single query',
  },
  { field: 'text', type: 'text', why: 'keyword search matches against the chunk text' },
];

/** Qdrant returns `payload_schema` as an object of field → { data_type, points }. */
export function parsePayloadIndexes(collectionInfo: unknown): PayloadIndex[] {
  const schema = (collectionInfo as { payload_schema?: Record<string, unknown> } | null)?.payload_schema;
  if (!schema || typeof schema !== 'object') return [];
  return Object.entries(schema).map(([field, v]) => {
    const o = (v ?? {}) as { data_type?: unknown; points?: unknown };
    return {
      field,
      type: typeof o.data_type === 'string' ? o.data_type : 'unknown',
      points: typeof o.points === 'number' ? o.points : null,
    };
  });
}

export interface IndexRecommendation {
  field: string;
  type: PayloadFieldType;
  /** Why it is worth having, in operator language. */
  why: string;
  /** True when the collection is still small enough that the gain is theoretical today. */
  smallForNow: boolean;
}

/**
 * Below this many points, an unindexed filter scan is not something anyone will notice.
 *
 * Stated rather than hidden so a reader knows why a recommendation is marked "not urgent" instead of
 * wondering whether the tool is confused.
 */
export const SCAN_TOLERANCE_POINTS = 10_000;

/**
 * Which of the fields we always filter on have no index yet.
 *
 * Reports them even when the collection is tiny — with `smallForNow` set — rather than staying silent.
 * A recommendation that appears only once the store is already slow arrives after the problem.
 */
export function recommendPayloadIndexes(
  present: readonly PayloadIndex[],
  pointCount: number | null | undefined,
  fields: readonly { field: string; type: PayloadFieldType; why: string }[] = FILTERED_PAYLOAD_FIELDS,
): IndexRecommendation[] {
  const have = new Set(present.map((p) => p.field));
  const small = (pointCount ?? 0) < SCAN_TOLERANCE_POINTS;
  return fields
    .filter((f) => !have.has(f.field))
    .map((f) => ({ field: f.field, type: f.type, why: f.why, smallForNow: small }));
}

/** One sentence for the surface. */
export function describePayloadIndexes(
  present: readonly PayloadIndex[],
  recommendations: readonly IndexRecommendation[],
  pointCount: number | null | undefined,
): string {
  const n = pointCount ?? 0;
  if (present.length === 0 && recommendations.length === 0) {
    return 'Nothing in this collection is filtered on, so it needs no payload indexes.';
  }
  if (recommendations.length === 0) {
    return `Every field this platform filters on is indexed (${present.length} ${present.length === 1 ? 'index' : 'indexes'}).`;
  }
  const missing = recommendations.map((r) => r.field).join(', ');
  return recommendations.every((r) => r.smallForNow)
    ? `${missing} ${recommendations.length === 1 ? 'is' : 'are'} filtered on every query but not indexed. At ${n.toLocaleString('en-IN')} points a scan is still cheap, so this is worth doing before the collection grows rather than after.`
    : `${missing} ${recommendations.length === 1 ? 'is' : 'are'} filtered on every query but not indexed, and at ${n.toLocaleString('en-IN')} points those queries are scanning. Indexing them is the single cheapest win available here.`;
}

/**
 * Validate a field name and type before asking Qdrant to index it.
 *
 * Returns an error string rather than throwing, so a route can answer 400 with something a person can act
 * on. A field name is restricted to what a payload key can actually be — this value reaches a REST path.
 */
export function validateIndexRequest(
  field: string,
  type: string,
): { ok: true; field: string; type: PayloadFieldType } | { ok: false; error: string } {
  const f = (field ?? '').trim();
  if (!f) return { ok: false, error: 'Give the payload field to index.' };
  if (!/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/.test(f)) {
    return {
      ok: false,
      error: 'A payload field is letters, digits, underscore and dot, starting with a letter or underscore.',
    };
  }
  const t = (type ?? '').trim().toLowerCase() as PayloadFieldType;
  if (!VALID_TYPES.includes(t)) {
    return { ok: false, error: `Index type must be one of: ${VALID_TYPES.join(', ')}.` };
  }
  return { ok: true, field: f, type: t };
}

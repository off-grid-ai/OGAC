// PURE retrieval query logic — zero I/O, zero `@/` imports, unit-testable in isolation (mirrors
// tenancy-policy.ts). This is the "brains" that both vector backends share: it turns a typed
// metadata filter into each store's native predicate DSL, and fuses ranked lists by Reciprocal
// Rank Fusion for hybrid (keyword + vector) search. The I/O adapters (qdrant.ts, brain.ts) call
// these and never re-implement the rules.

// ── Public option types (threaded from the API down to the adapters) ───────────

/** Retrieval mode. 'vector' = pure ANN (today's behaviour, the default). 'hybrid' = keyword
 *  (BM25/full-text) fused with vector. Backward compatible: omit → 'vector'. */
export type SearchMode = 'vector' | 'hybrid';

/** One metadata predicate over a document payload field (title / source / text, or any indexed
 *  key). `match` = exact equality on a string/number; `any` = value ∈ set; `text` = substring/
 *  full-text match on a field. Kept deliberately small and closed so both stores can express it. */
export type MetaCondition =
  | { field: string; match: string | number }
  | { field: string; any: Array<string | number> }
  | { field: string; text: string };

/** A conjunction of conditions (AND). Empty / absent → no filtering (byte-identical to today). */
export interface MetaFilter {
  must: MetaCondition[];
}

/** The full set of retrieval knobs. All optional; the empty object === today's behaviour. */
export interface RetrievalOptions {
  filter?: MetaFilter;
  mode?: SearchMode;
  /** The asker's identity for permissions-aware retrieval. Absent → no ACL enforcement (today's
   *  behaviour). Present → the adapters narrow server-side AND post-filter by the pure ACL rule so
   *  only docs the asker may see are returned. Un-ACL'd docs stay visible regardless. */
  asker?: { subject?: string | null; roles?: readonly string[] };
}

// ── Guards / normalization ─────────────────────────────────────────────────────

function isCondition(c: unknown): c is MetaCondition {
  if (typeof c !== 'object' || c === null) return false;
  const r = c as Record<string, unknown>;
  if (typeof r.field !== 'string' || r.field.length === 0) return false;
  if ('match' in r) return typeof r.match === 'string' || typeof r.match === 'number';
  if ('any' in r)
    return (
      Array.isArray(r.any) &&
      r.any.length > 0 &&
      r.any.every((v) => typeof v === 'string' || typeof v === 'number')
    );
  if ('text' in r) return typeof r.text === 'string' && r.text.length > 0;
  return false;
}

/**
 * PURE: coerce arbitrary (e.g. request-body) input into a validated MetaFilter, or null when there
 * is nothing to filter on. Never throws. Unknown/invalid conditions are dropped, so a partially
 * malformed filter degrades gracefully rather than 500-ing.
 */
export function normalizeFilter(input: unknown): MetaFilter | null {
  if (input == null) return null;
  const rawMust = Array.isArray(input)
    ? // Accept a bare array of conditions for ergonomics.
      (input as unknown[])
    : Array.isArray((input as Record<string, unknown>).must)
      ? ((input as Record<string, unknown>).must as unknown[])
      : null;
  if (!rawMust) return null;
  const must = rawMust.filter(isCondition);
  return must.length > 0 ? { must } : null;
}

/** PURE: normalize a mode string; anything but 'hybrid' → 'vector' (the safe default). */
export function normalizeMode(input: unknown): SearchMode {
  return input === 'hybrid' ? 'hybrid' : 'vector';
}

// ── Qdrant filter DSL ───────────────────────────────────────────────────────────

/** A Qdrant field condition, as its Query/Search API expects under `filter.must[]`. */
export type QdrantFieldCondition =
  | { key: string; match: { value: string | number } }
  | { key: string; match: { any: Array<string | number> } }
  | { key: string; match: { text: string } };

export interface QdrantFilter {
  must: QdrantFieldCondition[];
}

/**
 * PURE: map a typed MetaFilter onto Qdrant's `filter: { must: [...] }` DSL. Returns undefined when
 * there is nothing to filter, so callers can spread it into the request body and get byte-identical
 * output to today when no filter is supplied.
 */
export function buildQdrantFilter(filter?: MetaFilter | null): QdrantFilter | undefined {
  if (!filter || filter.must.length === 0) return undefined;
  const must: QdrantFieldCondition[] = filter.must.map((c) => {
    if ('match' in c) return { key: c.field, match: { value: c.match } };
    if ('any' in c) return { key: c.field, match: { any: c.any } };
    return { key: c.field, match: { text: c.text } };
  });
  return { must };
}

// ── LanceDB where clause ──────────────────────────────────────────────────────

// Single-quote-escape a string literal for LanceDB's SQL-ish filter grammar.
function sqlStr(v: string | number): string {
  if (typeof v === 'number') return String(v);
  return `'${v.replaceAll("'", "''")}'`;
}

// Only allow plain identifiers as column names — defends the generated SQL against injection via a
// crafted `field`. Anything else drops the condition (safe: narrows nothing).
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * PURE: map a typed MetaFilter onto a LanceDB `.where(...)` SQL predicate. Returns undefined when
 * there is nothing to filter (→ caller skips `.where`, byte-identical to today). Conjunction of
 * conditions joined by AND. `text` becomes a case-insensitive LIKE.
 */
export function buildLanceWhere(filter?: MetaFilter | null): string | undefined {
  if (!filter || filter.must.length === 0) return undefined;
  const clauses: string[] = [];
  for (const c of filter.must) {
    if (!IDENT_RE.test(c.field)) continue; // reject unsafe column names
    if ('match' in c) {
      clauses.push(`${c.field} = ${sqlStr(c.match)}`);
    } else if ('any' in c) {
      clauses.push(`${c.field} IN (${c.any.map(sqlStr).join(', ')})`);
    } else {
      // Case-insensitive substring match; escape LIKE wildcards in the needle.
      const needle = c.text.replaceAll("'", "''").replace(/([%_])/g, '\\$1');
      clauses.push(`LOWER(${c.field}) LIKE LOWER('%${needle}%') ESCAPE '\\'`);
    }
  }
  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

// ── ACL server-side narrowing (permissions-aware retrieval) ────────────────────────
// The pure access RULE lives in acl.ts (docVisibleTo). These builders translate an asker's grants
// into each store's native predicate so the vector store can NARROW server-side — the authoritative
// gate is still the post-filter (filterHitsByAcl), because the ACL predicate is a disjunction that
// includes "un-ACL'd docs stay visible", which a store can't fully express as one clause. Narrowing
// is an optimisation + defence-in-depth; the post-filter guarantees correctness on every backend.
//
// Grants shape: the asker matches a doc iff owner == subject, OR subject ∈ allowed_subjects, OR one
// of the asker's roles ∈ allowed_roles, OR the doc is un-ACL'd. `null` grants (anonymous, no roles)
// → no server narrowing (undefined), so the post-filter alone decides (still correct, just no push-down).
export interface AclGrants {
  subject?: string | null;
  roles?: readonly string[];
  /** Superuser roles that see everything — narrowing is skipped for them (post-filter also passes). */
  superuserRoles?: readonly string[];
  /** The ACL payload field names, so builder + ingest agree. */
  fields: { owner: string; allowedRoles: string; allowedSubjects: string; dataClass: string };
}

function hasSuperuser(g: AclGrants): boolean {
  const su = new Set((g.superuserRoles ?? []).map((r) => r.toLowerCase()));
  return (g.roles ?? []).some((r) => su.has(r.toLowerCase()));
}

/**
 * PURE: a Qdrant `should` (OR) group narrowing to docs the asker may see. Returns undefined when
 * narrowing should be skipped (superuser, or no identifying grants) — the post-filter still runs.
 * The "un-ACL'd stays visible" arm is handled by the post-filter, not here (Qdrant can't cheaply
 * express "field is absent OR empty" across all schemas), so this is a NON-authoritative narrowing.
 */
export function buildQdrantAclShould(g: AclGrants): QdrantFieldCondition[] | undefined {
  if (hasSuperuser(g)) return undefined;
  const should: QdrantFieldCondition[] = [];
  const subject = (g.subject ?? '').trim();
  if (subject) {
    should.push({ key: g.fields.owner, match: { value: subject } });
    should.push({ key: g.fields.allowedSubjects, match: { any: [subject] } });
  }
  const roles = (g.roles ?? []).map((r) => r.trim()).filter(Boolean);
  if (roles.length > 0) should.push({ key: g.fields.allowedRoles, match: { any: roles } });
  return should.length > 0 ? should : undefined;
}

// ── Reciprocal Rank Fusion (hybrid) ──────────────────────────────────────────────

/** Standard RRF constant — dampens the weight of any single list's top ranks. */
export const RRF_K = 60;

/**
 * PURE: fuse N ranked lists of ids into one ranked list by Reciprocal Rank Fusion. An id's fused
 * score is Σ 1/(k + rank) across the lists it appears in (rank is 0-based). Returns ids sorted by
 * descending fused score. Deterministic; ties broken by first-seen order. This is what makes
 * hybrid search "hybrid": fuse the vector ranking with the keyword ranking.
 */
export function rrfFuse(lists: ReadonlyArray<ReadonlyArray<string>>, k = RRF_K): string[] {
  const score = new Map<string, number>();
  const order: string[] = [];
  for (const list of lists) {
    list.forEach((id, rank) => {
      if (!score.has(id)) order.push(id);
      score.set(id, (score.get(id) ?? 0) + 1 / (k + rank));
    });
  }
  return order.sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
}

/** The fused score for a single id, exposed so adapters can attach it to their hit objects. */
export function rrfScore(lists: ReadonlyArray<ReadonlyArray<string>>, id: string, k = RRF_K): number {
  let s = 0;
  for (const list of lists) {
    const rank = list.indexOf(id);
    if (rank >= 0) s += 1 / (k + rank);
  }
  return s;
}

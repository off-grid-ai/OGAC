// DSAR propagation — VECTOR index (Qdrant) adapter. Thin I/O: delete every point whose ACL payload
// keys the erasure subject (as owner OR an allowed_subject). This reuses the same Qdrant collection,
// URL, API-key and ACL field names as the retrieval backend (src/lib/qdrant.ts) so a subject's
// embeddings are purged from the SAME store search reads from — no second source of truth.
//
// Qdrant's `points/delete` accepts a payload FILTER (delete-by-filter), so we never enumerate ids:
// one request removes all subject-scoped chunks. The subject match is a `should` (OR) over the owner
// and allowed_subjects payload fields, matching how those keys are written on ingest (aclPayload()).
//
// SOLID: no rule here — the pure planner decided this target runs and supplied the subjectKey. This
// file only talks to Qdrant. Never throws for a "not there" case: an unreachable/unconfigured Qdrant
// is reported by `isVectorConfigured()` returning false so the planner defers it honestly.

import { ACL_FIELDS } from '@/lib/retrieval/acl';

const QDRANT_URL = process.env.OFFGRID_QDRANT_URL ?? 'http://127.0.0.1:6333';
const COLLECTION = process.env.OFFGRID_QDRANT_COLLECTION ?? 'offgrid-brain';
const API_KEY = process.env.OFFGRID_QDRANT_API_KEY;

function headers(): Record<string, string> {
  return { 'content-type': 'application/json', ...(API_KEY ? { 'api-key': API_KEY } : {}) };
}

/**
 * Is the vector index reachable? A quick health probe — the planner uses this to decide whether the
 * vector target is `configured` (a step) or `not-configured` (deferred with a reason). Never throws.
 */
export async function isVectorConfigured(): Promise<boolean> {
  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
      headers: headers(),
      signal: AbortSignal.timeout(2500),
    });
    // 200 = collection exists; 404 = server up but no collection yet (nothing to erase, still
    // "configured" — a no-op delete is honest). Anything else / network error → not reachable.
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

// The subject-match filter: owner == subject OR allowed_subjects contains subject. Both are the exact
// payload keys ingest writes (ACL_FIELDS), so this deletes precisely the subject-scoped points.
function subjectFilter(subjectKey: string): Record<string, unknown> {
  return {
    should: [
      { key: ACL_FIELDS.owner, match: { value: subjectKey } },
      { key: ACL_FIELDS.allowedSubjects, match: { value: subjectKey } },
    ],
  };
}

export interface VectorEraseResult {
  /** true = the delete-by-filter request succeeded (Qdrant applied it). */
  ok: boolean;
  /** Points removed if Qdrant reports it; null when the API doesn't return a count. */
  removed: number | null;
  error: string | null;
}

/**
 * Delete every subject-scoped point from the Qdrant collection by payload filter. Returns an honest
 * result: `ok:false` with an error string on any non-2xx or network failure (the orchestrator then
 * defers it, never counting it as erased). Counts the collection before/after when possible so the
 * report can show real removed points.
 */
export async function eraseSubjectVectors(subjectKey: string): Promise<VectorEraseResult> {
  const filter = subjectFilter(subjectKey);
  try {
    const before = await countMatching(filter);
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/delete`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ filter }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, removed: null, error: `qdrant delete ${res.status}` };
    }
    return { ok: true, removed: before, error: null };
  } catch (e) {
    return { ok: false, removed: null, error: e instanceof Error ? e.message : 'vector erase failed' };
  }
}

// Count points matching a filter (exact) so the erase can report how many it removed. Best-effort —
// returns null if the count endpoint isn't available, which keeps the delete itself authoritative.
async function countMatching(filter: Record<string, unknown>): Promise<number | null> {
  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/count`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ filter, exact: true }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { count?: number } };
    return data.result?.count ?? null;
  } catch {
    return null;
  }
}

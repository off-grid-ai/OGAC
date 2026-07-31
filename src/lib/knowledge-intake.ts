// ─── Indexing a document into an org knowledge collection — the one client-side call ──────────────
//
// Three surfaces put documents into a collection (the collection detail panel, the quick-add on each
// collection card, and the brain add-document button). Each had its own `fetch` + `if (!res.ok) throw`,
// which is how the error handling drifted: one said "Failed to index document" for a 403 that had
// already explained itself as "read-only demo account". The request and the outcome vocabulary live
// here once; components only decide how to present it.

import { explainResponse, type Failure } from '@/lib/api-failure';

export type IntakeResult =
  | { ok: true; chunks: number }
  | { ok: false; failure: Failure };

/** POST a document (file text or pasted text — identical to the indexer) into a collection. */
export async function postKnowledgeDocument(
  collectionId: string,
  name: string,
  content: string,
): Promise<IntakeResult> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/knowledge/collections/${collectionId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
  } catch {
    // An unreachable server is breakage, not a refusal — say so without inventing a cause.
    return {
      ok: false,
      failure: { kind: 'broken', message: 'Could not reach the server.', refusal: false },
    };
  }
  if (!res.ok) return { ok: false, failure: await explainResponse(res, `index "${name}"`) };
  const body = (await res.json().catch(() => ({}))) as { chunks?: number };
  return { ok: true, chunks: body.chunks ?? 0 };
}

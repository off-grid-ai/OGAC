// ─── Embedding text through the on-prem gateway — the ONE call ─────────────────────────────────────
//
// Like `chunkText`, this had two identical copies (rag.ts for project documents, org-knowledge.ts for the
// org corpus). A second copy of the indexing call is how two halves of retrieval end up on different
// models or different timeouts, which shows up as citations that never match. One copy.
//
// Throws on a non-2xx: a caller must not silently store null vectors, because a document with no vector
// is invisible to retrieval while still being listed as indexed — a failure that presents as emptiness.
//
// WHY THE RETRY (live finding, 2026-07-31). The gateway aggregator round-robins /v1/embeddings across the
// fleet, and one node's llama.cpp was started WITHOUT `--embeddings`. Measured on the box: ten identical
// requests returned 200 200 501 200 200 501 … — a deterministic one-in-three failure, the node answering
// `{"code":501,"message":"This server does not support embeddings. Start it with --embeddings"}`.
//
// That is why 24 org documents sat in the product with zero indexed chunks: the indexing call failed a
// third of the time and nothing retried. A capability gap on ONE node of a load-balanced pool is exactly
// what a retry is for — the next attempt lands on a different node. The node itself still needs fixing
// (fleet repo); this makes the product correct in the meantime instead of silently losing every third
// document.
//
// Retries only on the statuses that mean "this node, not this request": 501 (capability), 502/503/504
// (node unreachable or overloaded), 429 (backpressure). A 400 or 401 is not retried — the request or the
// credential is wrong and hammering the pool will not change that.

import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

/** Statuses worth another node. PURE, so the policy is inspectable and testable on its own. */
export function isRetryableEmbeddingStatus(status: number): boolean {
  return status === 429 || status === 501 || status === 502 || status === 503 || status === 504;
}

const MAX_ATTEMPTS = 4;

export async function embed(input: string | string[]): Promise<number[][]> {
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await fetch(`${GATEWAY_URL}/v1/embeddings`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(60000),
    });
    if (r.ok) {
      const data = await r.json();
      return (data?.data ?? []).map((d: { embedding: number[] }) => d.embedding);
    }
    lastStatus = r.status;
    lastBody = (await r.text().catch(() => '')).slice(0, 200);
    if (!isRetryableEmbeddingStatus(r.status)) break;
    // Short, growing pause — enough for the balancer to move on, not enough to stall an upload.
    if (attempt < MAX_ATTEMPTS) await new Promise((res) => setTimeout(res, 150 * attempt));
  }
  // The status AND the node's own words: "embeddings 501" alone sent the last debugging session looking
  // at the wrong layer for an hour.
  throw new Error(`embeddings ${lastStatus}${lastBody ? ` — ${lastBody}` : ''}`);
}

import { randomUUID } from 'node:crypto';
import { getLineage } from '@/lib/adapters/registry';
import { SOURCES } from './sources';
import type {
  RetrievalHit,
  RetrievalOptions,
  RouteDecision,
  RouteResult,
  SourceKind,
} from './types';

// The router: detect intent → route to the matching sources → fuse results with Reciprocal Rank
// Fusion. Heuristic by default (deterministic, offline); a gateway classifier can refine it, but
// the heuristic is the dependable floor.
const SIGNALS: Record<SourceKind, RegExp> = {
  database:
    /\b(how many|count|number of|list|rows?|records?|dataset|table|total|average|sum|top \d)\b/i,
  tool: /\b(latest|sync|create|send|fetch|update|call|crm|email|invoke|status of|live|trigger)\b/i,
  kb: /\b(how (do|to)|policy|sop|procedure|steps?|guide|explain|what is|handle|process|why)\b/i,
};

const RRF_K = 60;

export function classify(query: string): RouteDecision {
  const intent = (Object.keys(SIGNALS) as SourceKind[]).filter((k) => SIGNALS[k].test(query));
  if (intent.length === 0) {
    // No strong signal → default to the knowledge base (the safe general destination).
    return { intent: ['kb'], reason: 'no strong signal; defaulted to the knowledge base' };
  }
  return { intent, reason: `matched intent signals: ${intent.join(', ')}` };
}

// Merge ranked lists from each source by Reciprocal Rank Fusion, so a top hit from one source
// competes fairly with a top hit from another regardless of raw score scale.
function fuse(lists: RetrievalHit[][], k: number): RetrievalHit[] {
  const scored = new Map<string, RetrievalHit & { fused: number }>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const key = hit.ref;
      const add = 1 / (RRF_K + rank);
      const existing = scored.get(key);
      if (existing) existing.fused += add;
      else scored.set(key, { ...hit, fused: add });
    });
  }
  return [...scored.values()]
    .sort((a, b) => b.fused - a.fused)
    .slice(0, k)
    .map(({ fused, ...hit }) => ({ ...hit, score: Number(fused.toFixed(4)) }));
}

export async function route(query: string, k = 8, opts?: RetrievalOptions): Promise<RouteResult> {
  const decision = classify(query);
  const selected = SOURCES.filter((s) => decision.intent.includes(s.kind));
  const lists = await Promise.all(selected.map((s) => s.search(query, k, opts)));
  const hits = fuse(lists, k);
  // Record which sources fed this retrieval through the lineage port (no-op unless configured).
  await getLineage().emit({
    job: 'brain.retrieve',
    run: randomUUID(),
    status: 'COMPLETE',
    inputs: selected.map((s) => s.label),
    outputs: ['retrieval-result'],
  });
  return { query, decision, hits };
}

export function listSources(): { id: string; kind: SourceKind; label: string; describe: string }[] {
  return SOURCES.map((s) => ({ id: s.id, kind: s.kind, label: s.label, describe: s.describe }));
}

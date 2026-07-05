// The retrieval router — the layer above the Brain that detects a query's intent and routes it
// to the right destination: the knowledge base (Brain), a structured database, or a configured
// tool/service. Each destination is a pluggable RetrievalSource; the router is source-agnostic,
// so a buyer can run it over the Brain alone, or wire in DB/tool sources, or all of them.
import type { RetrievalOptions } from './query';

export type { RetrievalOptions } from './query';

export type SourceKind = 'kb' | 'database' | 'tool';

// One result with its provenance — `ref` points back to the origin (doc id, dataset, connector).
export interface RetrievalHit {
  sourceId: string;
  sourceKind: SourceKind;
  title: string;
  snippet: string;
  ref: string;
  score: number;
}

export interface RetrievalSource {
  id: string;
  kind: SourceKind;
  label: string;
  describe: string;
  // opts is optional (metadata filter + vector/hybrid mode). Sources that can't honour it ignore
  // it; the KB source threads it down into the vector store. Absent opts === today's behaviour.
  search(query: string, k: number, opts?: RetrievalOptions): Promise<RetrievalHit[]>;
}

export interface RouteDecision {
  intent: SourceKind[];
  reason: string;
}

export interface RouteResult {
  query: string;
  decision: RouteDecision;
  hits: RetrievalHit[];
}

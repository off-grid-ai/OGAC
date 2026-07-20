// The retrieval router — the layer above the Brain that detects a query's intent and routes it
// to the right destination: the knowledge base (Brain), a structured database, or a configured
// tool/service. Each destination is a pluggable RetrievalSource; the router is source-agnostic,
// so a buyer can run it over the Brain alone, or wire in DB/tool sources, or all of them.
import type { RetrievalOptions } from './query';
import type { DataDomain } from '@/lib/data-domains';
import type { Asker } from '@/lib/retrieval/acl';
import type { RetrievalExecutionEvidence } from './evidence';

export type { RetrievalOptions } from './query';

export type SourceKind = 'kb' | 'database' | 'tool';

/** Request-scoped I/O context. Optional for backwards compatibility; production agent runs pass it. */
export interface RetrievalContext {
  orgId?: string;
  /** Canonical governed-run id used to correlate retrieval with audit/trace/lineage evidence. */
  correlationId?: string;
  /** The authenticated asker whose document ACL must be enforced by the Brain. */
  asker?: Asker;
  /**
   * Structured-data authorization decided before routing. Missing/legacy preserves non-agent
   * callers. A bound agent is either disabled (no declared domain matched) or authorized for an
   * exact org-scoped domain snapshot. The router excludes the generic dataset catalog whenever a
   * bound decision exists because catalog rows carry no authorized domain identity.
   */
  structuredAccess?:
    { state: 'disabled'; reason: string } | { state: 'authorized'; domains: DataDomain[] };
}

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
  search(
    query: string,
    k: number,
    opts?: RetrievalOptions,
    context?: RetrievalContext,
  ): Promise<RetrievalHit[]>;
}

export interface RouteDecision {
  intent: SourceKind[];
  reason: string;
}

export interface RouteResult {
  query: string;
  decision: RouteDecision;
  hits: RetrievalHit[];
  /** Null only when retrieval was deliberately skipped (for example an ungrounded agent). */
  evidence: RetrievalExecutionEvidence | null;
}

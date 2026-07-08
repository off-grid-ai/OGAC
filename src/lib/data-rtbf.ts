// ─── M4 data governance — the PURE RTBF (right-to-be-forgotten) scope resolver (zero-I/O) ──────
//
// A subject-erasure must cross EVERY plane that references the subject. The existing DSAR path
// (src/lib/erasure.ts) already plans + executes the erasure against the console-owned tables. This
// module EXTENDS that additively: given the console erasure plan PLUS the org's data catalog, it
// resolves the FULL cross-plane scope — which warehouse data assets, which vector-store collections,
// and which lineage records would also have to be purged. It fabricates nothing: an asset only lands
// in scope if it holds PII (per its classification posture). Purely computed → testable, and honest:
// warehouse/vector purge is DEFERRED (the S2 data engine executes it) and marked as such.
//
// SOLID: this is the RULE that answers "what does forgetting this person touch, everywhere". The
// route records the request + runs the console-plane steps; the engine (later) runs the deferred ones.

import { planErasure, type ErasurePlan } from '@/lib/erasure';

// The minimal catalog view the resolver needs — an asset + whether it holds PII (from its posture).
// Kept structural (not the DB row) so this stays pure and the store maps rows → this.
export interface RtbfAsset {
  id: string;
  name: string;
  source: string;
  /** Does this asset hold PII? (deriveAssetPosture(...).hasPii) — only PII assets are in scope. */
  hasPii: boolean;
  /** The PII entity tags on it (for the auditable scope record). */
  piiTags: string[];
}

// One resolved erasure target across a plane.
export interface RtbfTarget {
  plane: 'console' | 'warehouse' | 'vector' | 'lineage';
  /** Human label of the store/asset. */
  label: string;
  /** For console targets: the physical table. For warehouse: the asset id. */
  ref: string;
  /** 'immediate' = the console can erase now; 'deferred' = waits on the S2 data engine. */
  execution: 'immediate' | 'deferred';
  detail: string;
}

export interface RtbfScope {
  subject: string;
  targets: RtbfTarget[];
  /** How many targets the console can act on right now. */
  immediateCount: number;
  /** How many wait on the data engine / external planes. */
  deferredCount: number;
}

// Resolve the full cross-plane RTBF scope for a subject. PURE — takes the pre-built console plan and
// the catalog assets; returns every plane's targets with honest execution timing.
export function resolveRtbfScope(
  subject: string,
  assets: readonly RtbfAsset[],
  plan: ErasurePlan = planErasure(subject),
): RtbfScope {
  const s = (subject ?? '').trim();
  const targets: RtbfTarget[] = [];

  if (!s) return { subject: '', targets: [], immediateCount: 0, deferredCount: 0 };

  // 1) Console plane — the tables the DSAR executor deletes from now (immediate).
  for (const step of plan.steps) {
    targets.push({
      plane: 'console',
      label: step.store,
      ref: step.table,
      execution: 'immediate',
      detail: `DELETE FROM ${step.table} WHERE ${step.column} = subject`,
    });
  }

  // 2) Warehouse plane — every catalog asset that holds PII references the subject and must be
  //    purged by the S2 data engine (deferred — the console records the intent honestly).
  for (const a of assets) {
    if (!a.hasPii) continue;
    targets.push({
      plane: 'warehouse',
      label: a.name,
      ref: a.id,
      execution: 'deferred',
      detail: a.piiTags.length
        ? `Warehouse asset (${a.source}) holds PII [${a.piiTags.join(', ')}] — purge on S2.`
        : `Warehouse asset (${a.source}) — purge on S2.`,
    });
  }

  // 3) Vector store — subject-scoped embeddings/chunks (deferred; the retrieval index reindex).
  targets.push({
    plane: 'vector',
    label: 'Vector index (Qdrant) — subject-scoped chunks',
    ref: 'qdrant',
    execution: 'deferred',
    detail: 'Delete embeddings derived from the subject-bearing rows, then reindex.',
  });

  // 4) Lineage — provenance records tying answers back to the subject's data (deferred).
  targets.push({
    plane: 'lineage',
    label: 'Lineage / provenance records',
    ref: 'lineage',
    execution: 'deferred',
    detail: 'Redact subject references in run-lineage without breaking the audit chain.',
  });

  const immediateCount = targets.filter((t) => t.execution === 'immediate').length;
  const deferredCount = targets.length - immediateCount;
  return { subject: s, targets, immediateCount, deferredCount };
}

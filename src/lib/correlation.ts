// Cross-plane run-id correlation — the ONE key that ties a governed run together across the four
// observability planes (audit / trace / lineage / provenance). This is the pure, zero-import,
// unit-testable rule behind integration-success criterion C2: given a single governed-run id, derive
// the exact identifier each plane is keyed by, so one runId → four lookups → all four hit.
//
// Kept free of any I/O so it can be exhaustively unit-tested and reused by every emitter. The
// emitters (siem.shipAudit, chat-trace/scoring → Langfuse, lineage adapter, signing) all resolve
// their per-plane id THROUGH this helper, so correlation is derived in exactly one place.

export interface CorrelationIds {
  // The audit-plane id: OpenSearch `offgrid-audit` doc `_id` (and the `runId` field on the doc). The
  // runId is emitted verbatim so a `q=<runId>` / term lookup hits, matching the harness's search.
  auditId: string;
  // The Langfuse trace id: the runId with every non-alphanumeric char stripped. Langfuse trace ids
  // are looked up at GET /api/public/traces/<id>; the harness derives the same value as
  // runId.replace(/[^a-zA-Z0-9]/g, ''), so `traceId === normalize(runId)` must hold.
  traceId: string;
  // The Marquez / OpenLineage `run.runId`: the runId verbatim (namespace `offgrid-console`). Marquez
  // stores the run id as-given and exposes GET /api/v1/jobs/runs/<runId>, so it must equal the runId.
  lineageRunId: string;
  // A stable provenance reference: the runId verbatim, embedded in the signed payload so the signed
  // record is bound to — and discoverable by — the same run id.
  provenanceRef: string;
}

// Strip everything but ASCII alphanumerics. This is the single normalization Langfuse trace ids need
// (their API rejects some punctuation and the harness looks the trace up under the stripped form).
export function normalizeTraceId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9]/g, '');
}

// Derive all four plane identifiers from one canonical runId. Every governed-run emitter calls this
// so the four planes are provably keyed by the same run.
export function correlationIds(runId: string): CorrelationIds {
  return {
    auditId: runId,
    traceId: normalizeTraceId(runId),
    lineageRunId: runId,
    provenanceRef: runId,
  };
}

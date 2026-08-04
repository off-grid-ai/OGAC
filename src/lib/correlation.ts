// Cross-plane run-id correlation — the ONE key that ties a governed run together across the four
// observability planes (audit / trace / lineage / provenance). This is the pure, zero-import-of-app-code,
// unit-testable rule behind integration-success criterion C2: given a single governed-run id, derive
// the exact identifier each plane is keyed by, so one runId → four lookups → all four hit.
//
// Kept free of any I/O so it can be exhaustively unit-tested and reused by every emitter. The
// emitters (siem.shipAudit, chat-trace/scoring → Langfuse, lineage adapter, signing) all resolve
// their per-plane id THROUGH this helper, so correlation is derived in exactly one place.

import { createHash } from 'node:crypto';

export interface CorrelationIds {
  // The audit-plane id: OpenSearch `offgrid-audit` doc `_id` (and the `runId` field on the doc). The
  // runId is emitted verbatim so a `q=<runId>` / term lookup hits, matching the harness's search.
  auditId: string;
  // The Langfuse trace id: the runId with every non-alphanumeric char stripped. Langfuse trace ids
  // are looked up at GET /api/public/traces/<id>; the harness derives the same value as
  // runId.replace(/[^a-zA-Z0-9]/g, ''), so `traceId === normalize(runId)` must hold.
  traceId: string;
  // The Marquez / OpenLineage `run.runId`. Marquez REQUIRES run.runId to be a UUID — it silently
  // rejects/re-keys a non-UUID id like "run_b16393c5" (the job still lands, but GET
  // /api/v1/jobs/runs/<id> then 404s for the raw id — exactly the observed C2 miss). So the lineage
  // run id is a DETERMINISTIC UUIDv5 derived from the runId: same runId → same UUID, every time, with
  // no state. The harness derives the identical UUID (uuid5 of the runId under the same namespace) to
  // look the run up, so the run plane is keyed by one value both sides can compute from the runId.
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

// A fixed namespace UUID for Off Grid AI lineage run ids. Any constant UUID works as a UUIDv5 namespace;
// this one is arbitrary-but-fixed so the derivation is stable across deploys and reproducible by the
// harness. (Generated once; never change it, or previously-emitted lineage runs stop correlating.)
export const LINEAGE_UUID_NAMESPACE = '6f1a9d3e-2c4b-5a67-8f90-1b2c3d4e5f60';

// Deterministic RFC-4122 UUIDv5 (SHA-1 based). name-based: uuid5(namespace, name). Pure, no I/O, no
// randomness — the same (namespace, name) always yields the same UUID. This is the standard
// algorithm Marquez/OpenLineage clients use to turn an arbitrary string into a valid run UUID, and it
// is trivially reproducible in bash (openssl sha1 over the namespace bytes + name), so the harness can
// derive the identical id for its GET /api/v1/jobs/runs/<uuid> lookup.
export function uuidv5(name: string, namespace: string = LINEAGE_UUID_NAMESPACE): string {
  const nsHex = namespace.replaceAll('-', '');
  const nsBytes = Buffer.from(nsHex, 'hex');
  const hash = createHash('sha1')
    .update(nsBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = hash.subarray(0, 16);
  // Set version (5) and RFC-4122 variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// The lineage run id for a governed run: a deterministic UUIDv5 of the runId. Exported on its own so
// the (bash) harness note and any other caller can reference the exact derivation.
export function lineageRunUuid(runId: string): string {
  return uuidv5(runId);
}

// Derive all four plane identifiers from one canonical runId. Every governed-run emitter calls this
// so the four planes are provably keyed by the same run.
export function correlationIds(runId: string): CorrelationIds {
  return {
    auditId: runId,
    traceId: normalizeTraceId(runId),
    lineageRunId: lineageRunUuid(runId),
    provenanceRef: runId,
  };
}

// ─── Finding a run's trace without guessing at timestamps ─────────────────────────────────────────────
//
// The capability map records this against the OTel collector: "add durable correlation and exporter-failure
// state per application run." The correlation itself already exists — `correlationIds` derives a
// deterministic trace id from the run id, which is better than storing one because it cannot drift — but it
// was only ever used on the agent path. For an APP run there was no way to get from a console record to its
// trace except by searching Jaeger by time and hoping.
//
// The honesty half matters as much as the link. A trace that is not there can mean two very different
// things: nothing was exported, or the export FAILED. Presenting "no trace" as though it settled the
// question is the failure-presents-as-emptiness defect again, so the caption says both.

export interface TraceLookup {
  /**
   * The LANGFUSE trace id for this run — an arbitrary-string id, which is why the stripped form works
   * there. It is NOT a W3C/Jaeger trace id (those are 128-bit hex) and must never be used as one.
   */
  traceId: string;
  /**
   * Deep link into the trace viewer, or null when no viewer is configured.
   *
   * CORRECTED 2026-08-04: this used to be `${viewer}/trace/${traceId}`, which could never resolve in
   * Jaeger — `apprun_60a23031` normalises to `apprun60a23031`, and `p`/`r`/`u`/`n` are not hex. I shipped
   * that link earlier the same day and only caught it by querying Jaeger for a real run. It is now a
   * SEARCH by the run_id tag, which is findable because the audit span now carries that tag.
   */
  href: string | null;
  /** What a reader should understand if the trace is not there. */
  caveat: string;
}

/**
 * Where to find this run's trace.
 *
 * `viewerUrl` is passed in rather than read from the environment so this stays pure and so a caller that
 * has no viewer configured gets `href: null` instead of a link to nowhere.
 */
export function traceLookup(runId: string, viewerUrl?: string | null): TraceLookup {
  const { traceId } = correlationIds(runId);
  const base = (viewerUrl ?? '').trim().replace(/\/+$/, '');
  // SEARCH, not a derived id. The trace store generates its own trace ids, so the only durable key is a
  // tag the emitter puts on the span — `run_id`, added to the audit span for exactly this.
  const search = base
    ? `${base}/search?service=offgrid-console&tags=${encodeURIComponent(JSON.stringify({ run_id: runId }))}`
    : null;
  return {
    traceId,
    href: search,
    caveat:
      'If no trace is found, it may not have been exported rather than not have happened — and spans emitted before run_id tagging (2026-08-04) carry no run key at all, so older runs will not match. The run record above is the authoritative account of what ran.',
  };
}

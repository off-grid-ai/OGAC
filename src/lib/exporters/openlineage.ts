// OpenLineage lineage exporter — emit the platform's lineage as standard OpenLineage RunEvents to
// ANY OpenLineage consumer (Microsoft Purview, Collibra, Marquez, DataHub, …).
//
// OpenLineage is the open standard: a consumer ingests RunEvents at a lineage HTTP endpoint (Marquez
// exposes `/api/v1/lineage`; a generic OpenLineage HTTP transport POSTs to the configured URL). The
// event shape here mirrors src/lib/adapters/lineage.ts::runEvent (the same shape the platform
// already emits internally) so an enterprise catalog gets IDENTICAL, spec-compliant events. Builders
// are pure; the fetch is injected so export()/test() unit-test against a fake endpoint.

import { buildDatasetObject, type DatasetFacetSpec } from '@/lib/lineage-facets';
import type { Exporter, ExportResult, FetchLike, ProbeResult, ResolvedTarget } from './types';

const TIMEOUT_MS = 8000;
const PRODUCER = 'https://github.com/offgrid/console';
const DEFAULT_NAMESPACE = 'offgrid-console';

// A lineage record to export. Mirrors the internal LineageEvent so callers can hand the same shape.
export interface LineageExportRecord {
  job: string;
  run: string;
  status: 'START' | 'COMPLETE' | 'FAIL';
  namespace?: string;
  eventTime?: string;
  inputs?: string[];
  outputs?: string[];
  facets?: DatasetFacetSpec[];
}

// Normalize the OpenLineage endpoint to the ingest path. If the operator gave the Marquez base or a
// bare host, append `/api/v1/lineage`; if they gave the full lineage path, keep it. Pure.
export function openLineageUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  if (/\/api\/v1\/lineage$/.test(base)) return base;
  if (/\/lineage$/.test(base)) return base; // a generic transport endpoint the operator set explicitly
  return `${base}/api/v1/lineage`;
}

// Build ONE OpenLineage RunEvent. Same shape the internal adapter emits — spec-compliant. Pure.
export function buildRunEvent(rec: LineageExportRecord): Record<string, unknown> {
  const namespace = (rec.namespace?.trim()) || DEFAULT_NAMESPACE;
  const eventTime =
    rec.eventTime && !Number.isNaN(Date.parse(rec.eventTime))
      ? new Date(rec.eventTime).toISOString()
      : new Date().toISOString();
  const toDatasets = (names: string[] | undefined) =>
    (names ?? []).map((name) => buildDatasetObject(namespace, name, rec.facets));
  return {
    eventType: rec.status === 'FAIL' ? 'FAIL' : rec.status,
    eventTime,
    producer: PRODUCER,
    run: { runId: rec.run },
    job: { namespace, name: rec.job },
    inputs: toDatasets(rec.inputs),
    outputs: toDatasets(rec.outputs),
  };
}

// Auth header — OpenLineage HTTP transport uses `Authorization: Bearer <apiKey>` when a key is set;
// many on-prem consumers are unauthenticated. Pure.
export function openLineageHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export const openLineageExporter: Exporter<LineageExportRecord> = {
  id: 'openlineage',
  kind: 'lineage',

  async test(target: ResolvedTarget, fetchImpl: FetchLike): Promise<ProbeResult> {
    // Probe by posting a well-formed no-op START/COMPLETE pair is heavy; instead post a minimal
    // valid RunEvent for a throwaway probe run. A conformant consumer returns 200/201; auth failure
    // returns 401/403. We never leave residue beyond one probe run in the consumer's graph.
    const probe = buildRunEvent({
      job: 'offgrid.export.probe',
      run: `probe-${Date.now()}`,
      status: 'COMPLETE',
    });
    try {
      const res = await fetchImpl(openLineageUrl(target.endpoint), {
        method: 'POST',
        headers: openLineageHeaders(target.secret),
        body: JSON.stringify(probe),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, detail: `OpenLineage endpoint reachable (HTTP ${res.status}).` };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `Endpoint rejected the API key (HTTP ${res.status}).` };
      }
      return { ok: false, detail: `OpenLineage endpoint returned HTTP ${res.status}.` };
    } catch (e) {
      return { ok: false, detail: `Cannot reach OpenLineage endpoint: ${errMsg(e)}` };
    }
  },

  async export(
    target: ResolvedTarget,
    records: LineageExportRecord[],
    fetchImpl: FetchLike,
  ): Promise<ExportResult> {
    if (records.length === 0) return { ok: true, count: 0, detail: 'Nothing to export.' };
    // OpenLineage's HTTP transport is one event per POST. Ship sequentially; report first failure.
    let sent = 0;
    for (const rec of records) {
      try {
        const res = await fetchImpl(openLineageUrl(target.endpoint), {
          method: 'POST',
          headers: openLineageHeaders(target.secret),
          body: JSON.stringify(buildRunEvent(rec)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          return {
            ok: false,
            count: records.length,
            detail: `OpenLineage endpoint rejected event ${sent + 1}/${records.length} (HTTP ${res.status}).`,
          };
        }
        sent += 1;
      } catch (e) {
        return {
          ok: false,
          count: records.length,
          detail: `Export failed after ${sent}/${records.length} events: ${errMsg(e)}`,
        };
      }
    }
    return { ok: true, count: sent, detail: `Emitted ${sent} OpenLineage events.` };
  },
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

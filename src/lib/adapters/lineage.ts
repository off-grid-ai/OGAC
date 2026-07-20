import { buildDatasetObject, type DatasetFacetSpec } from '@/lib/lineage-facets';
import {
  lineageDeliveryReceipt,
  type LineageDeliveryReceipt,
} from '@/lib/lineage-delivery';
import { LINEAGE } from './services';
import type { LineageEvent, LineagePort } from './types';

// Data lineage behind one port. The first-party adapter is a no-op (lineage is implicit in the
// audit trace) so the console runs with zero OSS; Marquez receives real OpenLineage run events so
// source→answer becomes a queryable graph. Selected via OFFGRID_ADAPTER_LINEAGE. Emission is
// always best-effort and never blocks or fails the request.
const env = process.env;
const NAMESPACE = env.OFFGRID_LINEAGE_NAMESPACE ?? 'offgrid-console';
const PRODUCER = 'https://github.com/offgrid/console';

function metaOf(id: string) {
  const entry = LINEAGE.find((e) => e.meta.id === id);
  if (!entry) throw new Error(`lineage adapter meta '${id}' missing`);
  return entry.meta;
}

export const nullLineage: LineagePort = {
  meta: metaOf('native'),
  async emit(event) {
    // No-op: when no lineage backend is configured, lineage stays implicit in the audit log.
    return lineageDeliveryReceipt({
      adapterId: 'native',
      job: event.job,
      runId: event.run,
      status: 'implicit',
      httpStatus: null,
      attemptedAt: new Date().toISOString(),
      detail: 'Lineage remains implicit in the audit trace; no external delivery was attempted.',
    });
  },
};

// Build the OpenLineage dataset list, attaching any per-dataset facets (schema / columnLineage /
// dataQuality) the producer supplied for that name. A dataset with no matching spec stays bare.
function datasets(names: string[] | undefined, specs: DatasetFacetSpec[] | undefined) {
  return (names ?? []).map((name) => buildDatasetObject(NAMESPACE, name, specs));
}

// One OpenLineage RunEvent — the open standard Marquez ingests at POST /api/v1/lineage.
// Exported (pure, no I/O) so the facet-attachment shape is unit-testable without a live Marquez.
export function runEvent(event: LineageEvent, eventTime: string) {
  return {
    eventType: event.status === 'FAIL' ? 'FAIL' : event.status,
    eventTime,
    producer: PRODUCER,
    run: { runId: event.run },
    job: { namespace: NAMESPACE, name: event.job },
    inputs: datasets(event.inputs, event.facets),
    outputs: datasets(event.outputs, event.facets),
  };
}

export function createMarquezLineage(input: {
  baseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
} = {}): LineagePort {
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? (() => new Date());
  return {
    meta: metaOf('marquez'),
    async emit(event): Promise<LineageDeliveryReceipt> {
      const attemptedAt = now().toISOString();
      const url = input.baseUrl ?? env.OFFGRID_MARQUEZ_URL;
      if (!url) {
        return lineageDeliveryReceipt({
          adapterId: 'marquez',
          job: event.job,
          runId: event.run,
          status: 'not-configured',
          httpStatus: null,
          attemptedAt,
          detail: 'OFFGRID_MARQUEZ_URL is not configured; no event was delivered.',
        });
      }
      try {
        const response = await fetcher(`${url.replace(/\/$/, '')}/api/v1/lineage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(runEvent(event, attemptedAt)),
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          return lineageDeliveryReceipt({
            adapterId: 'marquez',
            job: event.job,
            runId: event.run,
            status: 'accepted',
            httpStatus: response.status,
            attemptedAt,
            detail: `Marquez accepted the OpenLineage event (HTTP ${response.status}).`,
          });
        }
        return lineageDeliveryReceipt({
          adapterId: 'marquez',
          job: event.job,
          runId: event.run,
          status: 'rejected',
          httpStatus: response.status,
          attemptedAt,
          detail: `Marquez rejected the OpenLineage event (HTTP ${response.status}).`,
        });
      } catch (error) {
        return lineageDeliveryReceipt({
          adapterId: 'marquez',
          job: event.job,
          runId: event.run,
          status: 'unreachable',
          httpStatus: null,
          attemptedAt,
          detail: `Marquez delivery failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
  };
}

export const marquezLineage: LineagePort = createMarquezLineage();

export const LINEAGE_PORTS: LineagePort[] = [nullLineage, marquezLineage];

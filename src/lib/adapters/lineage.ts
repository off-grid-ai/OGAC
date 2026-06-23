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
  async emit() {
    // No-op: when no lineage backend is configured, lineage stays implicit in the audit log.
  },
};

function datasets(names: string[] | undefined) {
  return (names ?? []).map((name) => ({ namespace: NAMESPACE, name }));
}

// One OpenLineage RunEvent — the open standard Marquez ingests at POST /api/v1/lineage.
function runEvent(event: LineageEvent, eventTime: string) {
  return {
    eventType: event.status === 'FAIL' ? 'FAIL' : event.status,
    eventTime,
    producer: PRODUCER,
    run: { runId: event.run },
    job: { namespace: NAMESPACE, name: event.job },
    inputs: datasets(event.inputs),
    outputs: datasets(event.outputs),
  };
}

export const marquezLineage: LineagePort = {
  meta: metaOf('marquez'),
  async emit(event) {
    const url = env.OFFGRID_MARQUEZ_URL;
    if (!url) return;
    try {
      await fetch(`${url}/api/v1/lineage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(runEvent(event, new Date().toISOString())),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Lineage is observational — a missing event must never break ingestion or retrieval.
    }
  },
};

export const LINEAGE_PORTS: LineagePort[] = [nullLineage, marquezLineage];

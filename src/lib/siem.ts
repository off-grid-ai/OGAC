// SIEM log-shipping. The audit log in Postgres is the source of truth; when OpenSearch is
// configured we ALSO ship each event to it for full-text search + SIEM dashboards. Fire-and-
// forget and best-effort — a SIEM outage never blocks or fails an audited request.
const OPENSEARCH_URL = process.env.OFFGRID_OPENSEARCH_URL;
const INDEX = process.env.OFFGRID_OPENSEARCH_INDEX ?? 'offgrid-audit';

interface Shippable {
  id: string;
  deviceId: string;
  model: string;
  outcome: string;
  tokens: number;
  leftDevice: boolean;
  keyId?: string | null;
  ts: string;
}

export function shipAudit(events: Shippable[]): void {
  if (!OPENSEARCH_URL || events.length === 0) return;
  // OpenSearch _bulk: alternating action + document lines, newline-delimited.
  const body =
    events
      .map(
        (e) => `${JSON.stringify({ index: { _index: INDEX, _id: e.id } })}\n${JSON.stringify(e)}`,
      )
      .join('\n') + '\n';
  fetch(`${OPENSEARCH_URL}/_bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body,
    signal: AbortSignal.timeout(4000),
  }).catch(() => {});
}

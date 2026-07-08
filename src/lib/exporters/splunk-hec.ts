// Splunk HEC audit exporter — export the canonical audit stream to Splunk's HTTP Event Collector.
//
// Splunk HEC accepts newline-delimited JSON events at `/services/collector` (or the raw endpoint),
// each shaped `{ time, sourcetype, source, event: {...} }`, authenticated with
// `Authorization: Splunk <token>`. The PAYLOAD builders here are pure (zero-I/O) and exhaustively
// tested; the only I/O is the fetch the run adapter passes in, so a unit test drives export()/test()
// with a fake fetch — never a real Splunk.
//
// We ship the canonical AuditEvent (audit-event.ts) verbatim as the HEC `event`, so a downstream
// Splunk search keys on the same field names (actor.id, action, org, outcome, model, costUsd) the
// rest of the platform uses. Nothing here reads or persists a token — the resolved token arrives on
// ResolvedTarget.secret at call time.

import type { AuditEvent } from '@/lib/audit-event';
import type { Exporter, ExportResult, FetchLike, ProbeResult, ResolvedTarget } from './types';

const TIMEOUT_MS = 8000;

// The HEC endpoint path. If the operator configured the collector base (host only, or including
// `/services/collector`), normalize to the JSON event endpoint. Pure.
export function hecUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  if (/\/services\/collector(\/event)?$/.test(base)) {
    return base.endsWith('/event') ? base : `${base}/event`;
  }
  return `${base}/services/collector/event`;
}

// The `Authorization: Splunk <token>` header HEC requires. Pure.
export function hecAuthHeader(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Splunk ${token}`;
  return h;
}

// Convert epoch/ISO to the fractional-epoch-seconds HEC wants for `time`. Pure.
export function hecTime(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.round(ms) / 1000 : Date.now() / 1000;
}

// Shape ONE audit event into a HEC event envelope. Pure.
export function buildHecEvent(ev: AuditEvent): Record<string, unknown> {
  return {
    time: hecTime(ev.ts),
    sourcetype: 'offgrid:audit',
    source: 'offgrid-console',
    event: ev,
  };
}

// Serialize a batch to the newline-delimited-JSON HEC body (HEC accepts concatenated JSON objects,
// no array wrapper). Pure — this is the exact bytes we POST.
export function buildHecBody(events: AuditEvent[]): string {
  return events.map((e) => JSON.stringify(buildHecEvent(e))).join('\n');
}

export const splunkHecExporter: Exporter<AuditEvent> = {
  id: 'splunk-hec',
  kind: 'audit',

  async test(target: ResolvedTarget, fetchImpl: FetchLike): Promise<ProbeResult> {
    // HEC has no dedicated ping; posting an empty body returns a well-formed HEC error/ack that
    // proves the token + endpoint are valid (200 with {"text":"No data",...}) vs 401/403 on a bad
    // token. We treat any 2xx OR the documented 400 "No data" as reachable+authenticated.
    try {
      const res = await fetchImpl(hecUrl(target.endpoint), {
        method: 'POST',
        headers: hecAuthHeader(target.secret),
        body: '',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.text().catch(() => '');
      if (res.ok) return { ok: true, detail: `HEC reachable (HTTP ${res.status}).` };
      // 400 "No data" means auth passed but the (empty) body had no event — endpoint+token are good.
      if (res.status === 400 && /no data/i.test(body)) {
        return { ok: true, detail: 'HEC reachable, token accepted (empty probe).' };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `Splunk rejected the token (HTTP ${res.status}).` };
      }
      return { ok: false, detail: `HEC returned HTTP ${res.status}.` };
    } catch (e) {
      return { ok: false, detail: `Cannot reach Splunk HEC: ${errMsg(e)}` };
    }
  },

  async export(
    target: ResolvedTarget,
    records: AuditEvent[],
    fetchImpl: FetchLike,
  ): Promise<ExportResult> {
    if (records.length === 0) return { ok: true, count: 0, detail: 'Nothing to export.' };
    try {
      const res = await fetchImpl(hecUrl(target.endpoint), {
        method: 'POST',
        headers: hecAuthHeader(target.secret),
        body: buildHecBody(records),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        return { ok: true, count: records.length, detail: `Shipped ${records.length} events.` };
      }
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        count: records.length,
        detail: `Splunk HEC rejected the batch (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}.`,
      };
    } catch (e) {
      return { ok: false, count: records.length, detail: `Export failed: ${errMsg(e)}` };
    }
  },
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

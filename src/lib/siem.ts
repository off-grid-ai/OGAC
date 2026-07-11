// SIEM log-shipping AND read-back. The audit log in Postgres is the source of truth; when
// OpenSearch is configured we ALSO ship each event to it for full-text search + SIEM dashboards.
// Shipping is fire-and-forget and best-effort — a SIEM outage never blocks or fails an audited
// request. Read-back (searchAudit) powers the console's Audit view: full-text + filtered search
// over the shipped stream, well beyond the 25-row Postgres slice on the Control page.
import { randomUUID } from 'node:crypto';
import { type AuditEvent, type AuditEventInput, buildAuditEvent } from '@/lib/audit-event';
import { correlationIds } from '@/lib/correlation';

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
  // Present ONLY on governed agent/chat-run audit docs — the correlation key that ties this audit
  // record to the same run's Langfuse trace, Marquez lineage event, and provenance record (C2).
  // Device/gateway events (the historical audit stream) leave it undefined.
  runId?: string | null;
  ts: string;
  // ─── Canonical attribution (Phase 4.11) — ADDITIVE. Device/gateway docs leave these undefined;
  // every attributed producer (chat, runs, governance, access, data) fills them via shipAuditEvent.
  // The nested `actor` mirrors the canonical contract; the flat actorId/actorType/action/org/project
  // fields exist so OpenSearch term-filters + aggregations key directly (avoids nested mapping), and
  // the pre-4.11 device docs stay valid (all optional).
  actor?: { type: 'user' | 'machine'; id: string; label: string };
  actorId?: string;
  actorType?: 'user' | 'machine';
  action?: string;
  org?: string;
  project?: string;
  resource?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  ip?: string;
}

export interface RunAudit {
  runId: string;
  agentId: string;
  outcome: string;
  model: string;
  tokens?: number;
  caller?: string | null;
  ts?: string;
}

// Pure: shape a governed-run into an OpenSearch audit doc keyed by the run's correlation id. The doc
// `_id` (== `id`) AND its `runId` field are the run's `auditId` (== runId), so the C2 harness's
// `_search?q=<runId>` hits. No I/O — unit-testable in isolation.
export function buildRunAuditDoc(run: RunAudit): Shippable {
  const auditId = correlationIds(run.runId).auditId;
  return {
    id: auditId,
    runId: auditId,
    deviceId: `agent:${run.agentId}`,
    model: run.model,
    outcome: run.outcome,
    tokens: run.tokens ?? 0,
    leftDevice: true,
    keyId: run.caller ?? null,
    ts: run.ts ?? new Date().toISOString(),
  };
}

// Ship the governed-run audit doc. ADDITIVE to the device/gateway audit stream (shipAudit) — it does
// not touch that path. Best-effort and non-blocking: an OpenSearch outage never fails the run.
export function shipRunAudit(run: RunAudit): void {
  shipAudit([buildRunAuditDoc(run)]);
}

// Pure: shape a CANONICAL AuditEvent (Phase 4.11) into a shippable OpenSearch doc. The nested actor
// is preserved AND its fields are flattened (actorId/actorType/action/…) so term filters + aggs key
// directly. `deviceId`/`model`/`tokens`/`leftDevice` are kept populated so the SAME index/mapping
// serves both the pre-4.11 device docs and the new attributed docs, and legacy views don't break.
// The doc `_id` is the runId when present (so run docs de-dup + `_search?q=<runId>` hits) else a uuid.
export function auditEventToDoc(ev: AuditEvent): Shippable {
  const id = ev.runId ? correlationIds(ev.runId).auditId : randomUUID();
  return {
    id,
    deviceId: ev.resource ?? `actor:${ev.actor.id}`,
    model: ev.model ?? '',
    outcome: ev.outcome,
    tokens: ev.tokens?.total ?? 0,
    leftDevice: false,
    keyId: ev.actor.id,
    runId: ev.runId ?? null,
    ts: ev.ts,
    actor: ev.actor,
    actorId: ev.actor.id,
    actorType: ev.actor.type,
    action: ev.action,
    org: ev.org,
    project: ev.project,
    resource: ev.resource,
    promptTokens: ev.tokens?.prompt,
    completionTokens: ev.tokens?.completion,
    costUsd: ev.costUsd,
    ip: ev.ip,
  };
}

// Ship a canonical attributed audit event: normalize via the pure builder, shape to a doc, ship.
// Best-effort / non-blocking — the single entry point every attributed producer calls. ADDITIVE to
// both other ship paths; never throws (so it can't fail the action being audited).
export function shipAuditEvent(input: AuditEventInput): void {
  try {
    shipAudit([auditEventToDoc(buildAuditEvent(input))]);
  } catch {
    /* audit is best-effort — never fail the action */
  }
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

export function siemConfigured(): boolean {
  return Boolean(OPENSEARCH_URL);
}

// The read-back filter contract the Audit-log VIEW consumes (Phase 4.11): free text + exact-match
// facets on actor / action / project / outcome + a [from,to] time window + paging. All optional.
export interface AuditSearchParams {
  q?: string; // free text (matched against model / outcome / deviceId / keyId / actorId / action)
  outcome?: string; // exact-match filter (ok | blocked | redacted | error)
  actor?: string; // exact-match on actorId (user email or machine client-id)
  action?: string; // exact-match on the canonical action (chat.send | policy.change | …)
  project?: string; // exact-match on project
  deviceId?: string; // exact-match filter (legacy device/gateway docs)
  from?: string; // time-window lower bound (ISO) — ev.ts >= from
  to?: string; // time-window upper bound (ISO) — ev.ts <= to
  size?: number; // page size (default 50, max 200)
  offset?: number; // page offset (was `from`; renamed so `from` is the time bound per the contract)
}

export interface AuditHit extends Shippable {
  score: number | null;
}

export interface AuditSearchResult {
  total: number;
  hits: AuditHit[];
  configured: boolean;
  error?: string;
}

interface OsHit {
  _id: string;
  _score: number | null;
  _source: Shippable;
}

// Build the OpenSearch query DSL: a bool query with a full-text `multi_match` (when `q` is given)
// plus term filters. Empty query → match_all, newest first.
// eslint-disable-next-line complexity
function buildQuery(p: AuditSearchParams): Record<string, unknown> {
  const must: Record<string, unknown>[] = [];
  const filter: Record<string, unknown>[] = [];
  if (p.q && p.q.trim()) {
    must.push({
      multi_match: {
        query: p.q.trim(),
        fields: ['model', 'outcome', 'deviceId', 'keyId', 'runId', 'actorId', 'action', 'label'],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    });
  }
  if (p.outcome) filter.push({ term: { 'outcome.keyword': p.outcome } });
  if (p.actor) filter.push({ term: { 'actorId.keyword': p.actor } });
  if (p.action) filter.push({ term: { 'action.keyword': p.action } });
  if (p.project) filter.push({ term: { 'project.keyword': p.project } });
  if (p.deviceId) filter.push({ term: { 'deviceId.keyword': p.deviceId } });
  if (p.from || p.to) {
    const range: Record<string, string> = {};
    if (p.from) range.gte = p.from;
    if (p.to) range.lte = p.to;
    filter.push({ range: { ts: range } });
  }
  const bool = must.length || filter.length ? { bool: { must, filter } } : { match_all: {} };
  return {
    query: bool,
    sort: [{ ts: { order: 'desc', unmapped_type: 'date' } }],
    size: Math.min(p.size ?? 50, 200),
    from: p.offset ?? 0,
  };
}

// Read-back: full-text + filtered search over the shipped audit index. Best-effort — returns an
// error string (not a throw) so the view degrades gracefully when OpenSearch is down.
// eslint-disable-next-line complexity
export async function searchAudit(p: AuditSearchParams): Promise<AuditSearchResult> {
  if (!OPENSEARCH_URL) return { total: 0, hits: [], configured: false };
  try {
    const res = await fetch(`${OPENSEARCH_URL}/${INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildQuery(p)),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { total: 0, hits: [], configured: true, error: `OpenSearch ${res.status}` };
    }
    const json = (await res.json()) as {
      hits?: { total?: { value?: number } | number; hits?: OsHit[] };
    };
    const totalRaw = json.hits?.total;
    const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);
    const hits = (json.hits?.hits ?? []).map((h) => ({ ...h._source, id: h._id, score: h._score }));
    return { total, hits, configured: true };
  } catch (e) {
    return { total: 0, hits: [], configured: true, error: (e as Error).message };
  }
}

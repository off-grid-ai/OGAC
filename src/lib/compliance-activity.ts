// PURE compliance-activity report builder — zero imports, zero I/O, fully unit-testable. This is the
// evidence-over-a-time-range surface for the Regulatory / DPO module: it turns the real canonical
// audit ledger (`audit_events_v2`, "who did what, on what, with which model/tokens/cost, and how it
// ended") plus provenance-coverage counts into a structured Data Protection Impact Assessment / DPO
// activity report, and serializes it to CSV / JSON / Markdown.
//
// The network read (Postgres `audit_events_v2` + `agent_runs`) lives in `src/lib/store.ts`
// (`readComplianceActivity`); the thin route calls that, then hands the rows here. This file NEVER
// fetches. Keeping the aggregation + serialization pure means the "who did what / what was blocked /
// what it cost over <range>" evidence is exhaustively testable with plain in-memory rows — no DB, no
// auth chain, no mocks.

// ── Input row: one canonical audit event, as read back from `audit_events_v2` ───────────────────
// Everything optional/defensive so a partially-populated historical row still folds cleanly.
export interface ActivityRow {
  ts?: string; // ISO-8601
  actorType?: string; // 'user' | 'machine' | ...
  actorId?: string;
  actorLabel?: string;
  org?: string;
  project?: string | null;
  action?: string; // canonical AuditAction (chat.send, agent.run, policy.change, budget.deny, ...)
  resource?: string | null;
  model?: string | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  outcome?: string; // ok | blocked | redacted | error | denied
  runId?: string | null;
}

// Provenance-coverage signal for the same window, computed by the store from `agent_runs`: how many
// governed agent runs there were and how many carry a signed provenance record.
export interface ProvenanceCoverage {
  runs: number; // total agent runs in the window
  signed: number; // of those, how many have a non-null provenance signature
}

export interface ActivityQuery {
  from?: string; // ISO / date-time lower bound (inclusive)
  to?: string; // ISO / date-time upper bound (inclusive)
  org?: string;
}

// ── Report model ────────────────────────────────────────────────────────────────────────────────
export type ActivityOutcome = 'ok' | 'blocked' | 'redacted' | 'denied' | 'error' | 'unknown';

export interface CountRow {
  key: string;
  events: number;
  costUsd: number;
  tokens: number;
  blocked: number; // blocked + denied + error (i.e. NOT allowed through)
}

export interface OutcomeTotals {
  ok: number;
  blocked: number;
  redacted: number;
  denied: number;
  error: number;
}

export interface ComplianceActivity {
  generatedAt: string;
  from: string | null;
  to: string | null;
  org: string;
  totals: {
    events: number;
    costUsd: number;
    tokens: number;
    actors: number;
    blockedOrDenied: number; // enforcement actions: blocked + denied + budget-deny + error
    redacted: number;
  };
  outcomes: OutcomeTotals;
  byActor: CountRow[]; // who did what — descending by events
  byAction: CountRow[]; // what happened — descending by events
  byModel: CountRow[]; // which models carried the load / cost — descending by cost
  blockedEvents: BlockedEvent[]; // the actual denied/blocked actions (the "what was refused" evidence)
  provenance: {
    runs: number;
    signed: number;
    coveragePct: number; // signed / runs, 0 when no runs
  };
}

// A single enforcement event surfaced verbatim in the evidence pack — the auditable "we refused X".
export interface BlockedEvent {
  ts: string;
  actor: string;
  action: string;
  outcome: ActivityOutcome;
  resource: string;
  project: string;
  model: string;
  runId: string;
}

// ── Helpers (pure) ──────────────────────────────────────────────────────────────────────────────
function normOutcome(raw: string | undefined): ActivityOutcome {
  const v = (raw ?? '').toLowerCase().trim();
  if (['ok', 'allow', 'allowed', 'success', 'succeeded', 'permit', 'permitted', 'done'].includes(v))
    return 'ok';
  if (['redact', 'redacted', 'masked'].includes(v)) return 'redacted';
  if (['block', 'blocked', 'quarantined'].includes(v)) return 'blocked';
  if (['deny', 'denied', 'reject', 'rejected', 'forbidden', 'unauthorized', 'cancelled'].includes(v))
    return 'denied';
  if (['error', 'failed', 'failure', 'exception'].includes(v)) return 'error';
  return 'unknown';
}

// An enforcement action = anything that did NOT pass cleanly (blocked / denied / error). These are
// the actions a regulator cares about: the guardrail / policy / budget refusals.
function isEnforcement(o: ActivityOutcome): boolean {
  return o === 'blocked' || o === 'denied' || o === 'error';
}

function money(n: number): number {
  return Number(n.toFixed(4));
}

function actorDisplay(r: ActivityRow): string {
  return (r.actorLabel || r.actorId || 'unknown').trim() || 'unknown';
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Roll rows up by a key extractor into a CountRow[], sorted by the given metric descending.
function groupBy(
  rows: ActivityRow[],
  keyOf: (r: ActivityRow) => string,
  sortBy: 'events' | 'costUsd',
): CountRow[] {
  const map = new Map<string, CountRow>();
  for (const r of rows) {
    const key = keyOf(r) || 'unknown';
    const cur = map.get(key) ?? { key, events: 0, costUsd: 0, tokens: 0, blocked: 0 };
    cur.events += 1;
    cur.costUsd = money(cur.costUsd + num(r.costUsd));
    cur.tokens += num(r.totalTokens);
    if (isEnforcement(normOutcome(r.outcome))) cur.blocked += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => {
    const d = b[sortBy] - a[sortBy];
    return d !== 0 ? d : a.key.localeCompare(b.key);
  });
}

// ── The pure aggregator: raw ledger rows (+ provenance coverage) → the DPO activity report ───────
export function buildComplianceActivity(
  rows: ActivityRow[],
  coverage: ProvenanceCoverage,
  q: ActivityQuery,
  now: string = new Date().toISOString(),
): ComplianceActivity {
  const outcomes: OutcomeTotals = { ok: 0, blocked: 0, redacted: 0, denied: 0, error: 0 };
  let events = 0;
  let costUsd = 0;
  let tokens = 0;
  const actors = new Set<string>();
  const blockedEvents: BlockedEvent[] = [];

  for (const r of rows) {
    events += 1;
    costUsd += num(r.costUsd);
    tokens += num(r.totalTokens);
    actors.add(actorDisplay(r));
    const o = normOutcome(r.outcome);
    if (o !== 'unknown') outcomes[o] += 1;
    if (isEnforcement(o)) {
      blockedEvents.push({
        ts: r.ts ?? '',
        actor: actorDisplay(r),
        action: (r.action ?? 'unknown').trim() || 'unknown',
        outcome: o,
        resource: (r.resource ?? '').trim(),
        project: (r.project ?? '').trim(),
        model: (r.model ?? '').trim(),
        runId: (r.runId ?? '').trim(),
      });
    }
  }

  // Newest-first for the blocked-event evidence list.
  blockedEvents.sort((a, b) => (a.ts && b.ts ? b.ts.localeCompare(a.ts) : a.ts ? -1 : b.ts ? 1 : 0));

  const runs = Math.max(0, Math.trunc(coverage.runs));
  const signed = Math.min(Math.max(0, Math.trunc(coverage.signed)), runs);

  return {
    generatedAt: now,
    from: q.from ?? null,
    to: q.to ?? null,
    org: (q.org ?? 'default').trim() || 'default',
    totals: {
      events,
      costUsd: money(costUsd),
      tokens,
      actors: actors.size,
      blockedOrDenied: outcomes.blocked + outcomes.denied + outcomes.error,
      redacted: outcomes.redacted,
    },
    outcomes,
    byActor: groupBy(rows, actorDisplay, 'events'),
    byAction: groupBy(rows, (r) => (r.action ?? 'unknown').trim(), 'events'),
    byModel: groupBy(rows, (r) => (r.model ?? '').trim() || '(none)', 'costUsd'),
    blockedEvents,
    provenance: {
      runs,
      signed,
      coveragePct: runs > 0 ? Math.round((signed / runs) * 100) : 0,
    },
  };
}

// ── Serializers — pure, so the export route stays a thin I/O shell ──────────────────────────────
export type ActivityFormat = 'json' | 'csv' | 'md';

export function parseActivityFormat(raw: string | null | undefined): ActivityFormat {
  const v = (raw ?? '').toLowerCase().trim();
  if (v === 'csv') return 'csv';
  if (v === 'md' || v === 'markdown') return 'md';
  return 'json';
}

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// CSV export = the blocked/enforcement evidence rows (the audit trail a regulator scans), preceded by
// a header row. One flat table keeps it spreadsheet-friendly.
export function activityToCsv(a: ComplianceActivity): string {
  const head = ['time', 'actor', 'action', 'outcome', 'project', 'model', 'resource', 'run_id'];
  const lines = a.blockedEvents.map((e) =>
    [e.ts, e.actor, e.action, e.outcome, e.project, e.model, e.resource, e.runId]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

export function activityToJson(a: ComplianceActivity): string {
  return JSON.stringify(a, null, 2);
}

function rangeLabel(a: ComplianceActivity): string {
  const from = a.from ?? 'beginning';
  const to = a.to ?? 'now';
  return `${from} → ${to}`;
}

// Markdown = the human-readable DPIA / DPO activity pack a data-protection officer hands to a
// regulator: summary, outcome breakdown, provenance coverage, who did what, and every refusal.
export function activityToMarkdown(a: ComplianceActivity): string {
  const l: string[] = [];
  l.push('# Off Grid AI — Data Processing Activity Report (DPIA)');
  l.push('');
  l.push(`Generated: ${a.generatedAt}`);
  l.push(`Org: ${a.org}`);
  l.push(`Range: ${rangeLabel(a)}`);
  l.push('');
  l.push('## Summary');
  l.push(`- Governed events: **${a.totals.events}**`);
  l.push(`- Distinct actors: **${a.totals.actors}**`);
  l.push(`- Blocked / denied / errored (enforcement): **${a.totals.blockedOrDenied}**`);
  l.push(`- Redacted (PII masked): **${a.totals.redacted}**`);
  l.push(`- Total tokens: **${a.totals.tokens}**`);
  l.push(`- Total cost: **$${a.totals.costUsd.toFixed(4)}**`);
  l.push(
    `- Provenance coverage: **${a.provenance.coveragePct}%** (${a.provenance.signed}/${a.provenance.runs} agent runs cryptographically signed)`,
  );
  l.push('');
  l.push('## Outcomes');
  l.push(`- ok: ${a.outcomes.ok}`);
  l.push(`- blocked: ${a.outcomes.blocked}`);
  l.push(`- denied: ${a.outcomes.denied}`);
  l.push(`- redacted: ${a.outcomes.redacted}`);
  l.push(`- error: ${a.outcomes.error}`);
  l.push('');
  l.push('## Who did what (by actor)');
  l.push('| Actor | Events | Blocked | Tokens | Cost (USD) |');
  l.push('|---|---:|---:|---:|---:|');
  for (const r of a.byActor)
    l.push(`| ${r.key} | ${r.events} | ${r.blocked} | ${r.tokens} | ${r.costUsd.toFixed(4)} |`);
  l.push('');
  l.push('## Activity (by action)');
  l.push('| Action | Events | Blocked | Cost (USD) |');
  l.push('|---|---:|---:|---:|');
  for (const r of a.byAction)
    l.push(`| ${r.key} | ${r.events} | ${r.blocked} | ${r.costUsd.toFixed(4)} |`);
  l.push('');
  l.push('## Enforcement — blocked & denied actions');
  if (a.blockedEvents.length === 0) {
    l.push('_No blocked or denied actions in this window._');
  } else {
    l.push('| Time | Actor | Action | Outcome | Project | Model | Run |');
    l.push('|---|---|---|---|---|---|---|');
    for (const e of a.blockedEvents)
      l.push(
        `| ${e.ts} | ${e.actor} | ${e.action} | ${e.outcome} | ${e.project} | ${e.model} | ${e.runId} |`,
      );
  }
  l.push('');
  return l.join('\n');
}

export function serializeActivity(a: ComplianceActivity, fmt: ActivityFormat): string {
  if (fmt === 'csv') return activityToCsv(a);
  if (fmt === 'md') return activityToMarkdown(a);
  return activityToJson(a);
}

export function activityContentType(fmt: ActivityFormat): string {
  if (fmt === 'csv') return 'text/csv; charset=utf-8';
  if (fmt === 'md') return 'text/markdown; charset=utf-8';
  return 'application/json; charset=utf-8';
}

export function activityFilename(a: ComplianceActivity, fmt: ActivityFormat): string {
  const ext = fmt === 'md' ? 'md' : fmt;
  const stamp = (a.to ?? a.generatedAt).slice(0, 10);
  return `offgrid-dpia-activity-${stamp}.${ext}`;
}

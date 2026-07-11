// PURE operator-home synthesizer — ZERO imports, zero I/O, fully unit-testable in isolation. This
// is the SOLID seam for the Overview module (mirrors tenancy-policy.ts): the page in
// (console)/overview/page.tsx does ALL the fetching — analytics, finops, policy/guardrails status,
// the SIEM audit stream, service health, recent agent runs — then hands the raw module snapshots to
// synthesizeOperatorHome() here, which cross-references them into ONE jobs-oriented view-model. No
// network, no DB, no Next/auth chain reaches this file, so the whole synthesis is asserted with
// representative inputs and no mocks.
//
// The vision (Pillar 4 — operator home) asks the Overview to answer four operator jobs in one
// glance, each deep-linking into its module:
//   posture  → "is it controlled right now?"  (blocked/redacted decisions across audit+policy+guardrails)
//   cost     → "what is it costing?"           (live spend, on-prem dividend, budgets)
//   health   → "is it up?"                     (core service reachability)
//   activity → "what just ran?"                (recent agent runs)
// Plus the cross-module synthesis the generic dashboard couldn't produce: a single
// "blocking decisions (last 24h)" feed that UNIONS the audit stream's blocked/denied events, the
// policy engine's denies, and the guardrail redactions — the governance events an operator must see.

// ── Loose input snapshots (only the fields the synthesis reads; every field defensive) ──────────
// These mirror the shapes the real module functions return, but are re-declared loosely here so the
// pure file imports nothing. The page passes the real objects; extra fields are ignored.

export interface AnalyticsSnapshot {
  totalEvents: number;
  totalTokens: number;
  p50: number;
  p95: number;
  egressRate: number; // 0..1 share of traffic that left the box
  outcomes: { ok: number; redacted: number; blocked: number };
}

export interface FinOpsSnapshot {
  totals: { requests: number; tokens: number; costUsd: number; localShare: number };
  byKey: { name?: string; label?: string; pct: number | null; budgetUsd: number | null }[];
}

export interface PolicySnapshot {
  engine: string;
  reachable: boolean;
}

export interface GuardrailsSnapshot {
  engine: string; // 'presidio' | 'regex'
  reachable: boolean;
  configured: boolean;
}

// A single audit/SIEM row (already normalized by siem-view). We only read outcome + ts + who/what.
export interface AuditRow {
  id: string;
  ts: string; // ISO-8601, or '' when unknown
  actor: string;
  action: string;
  outcome: string; // 'allowed' | 'denied' | 'blocked' | 'error' | 'unknown'
  detail: string;
}

// A normalized policy decision row (from policy-view). We only care about the denies.
export interface DecisionRow {
  id: string;
  allow: boolean;
  path: string;
  input: string;
  timestamp: string; // ISO-8601, or ''
}

export interface ServiceHealthRow {
  id: string;
  label: string;
  status: 'up' | 'down';
  ms: number | null;
}

export interface ActivityRow {
  id: string;
  agentId: string;
  query: string;
  status: string;
  startedAt: string;
}

export interface OperatorHomeInput {
  analytics: AnalyticsSnapshot | null;
  finops: FinOpsSnapshot | null;
  policy: PolicySnapshot | null;
  guardrails: GuardrailsSnapshot | null;
  audit: AuditRow[];
  decisions: DecisionRow[];
  services: ServiceHealthRow[];
  activity: ActivityRow[];
  /** Epoch ms — the "now" the 24h window is measured against. Injected for deterministic tests. */
  now: number;
  connectors?: { status: string }[];
}

// ── Output view-model ───────────────────────────────────────────────────────────────────────────

export interface HomeTile {
  label: string;
  value: string;
  hint?: string;
  tone: 'good' | 'warn' | 'bad' | 'muted';
  href: string;
}

export type BlockingSource = 'audit' | 'policy' | 'guardrails';

export interface BlockingDecision {
  id: string;
  source: BlockingSource;
  /** What was stopped, in operator language. */
  title: string;
  /** Who / what triggered it (actor, policy path, or engine). */
  subject: string;
  /** blocked | denied | redacted */
  kind: 'blocked' | 'denied' | 'redacted';
  ts: string; // ISO-8601, or ''
  /** Where the operator drills into the full record for this source. */
  href: string;
}

export interface OperatorHome {
  posture: HomeTile[];
  cost: HomeTile[];
  health: {
    up: number;
    total: number;
    tone: 'good' | 'warn' | 'bad';
    tile: HomeTile;
    items: { id: string; label: string; status: 'up' | 'down'; ms: number | null }[];
  };
  activity: ActivityRow[];
  /** The cross-module governance feed: audit ∪ policy ∪ guardrails blocking events in the window. */
  blocking: {
    windowHours: number;
    total: number;
    items: BlockingDecision[];
    /** One-line operator summary, outcome-first. */
    summary: string;
  };
}

// ── Helpers (pure) ────────────────────────────────────────────────────────────────────────────
function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function parseTs(ts: string): number {
  if (!ts) return Number.NaN;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? Number.NaN : t;
}

/** Within the trailing window, OR undated (kept so a producer that drops timestamps still surfaces). */
function inWindow(ts: string, now: number, windowMs: number): boolean {
  const t = parseTs(ts);
  if (Number.isNaN(t)) return true;
  return t >= now - windowMs && t <= now + 60_000; // small future skew tolerance
}

const WINDOW_HOURS = 24;

// ── The synthesizer ─────────────────────────────────────────────────────────────────────────────

// PII-guardrails posture for the home tile. Outcome-based by design: NEVER surface the underlying
// engine/product name (e.g. the OSS scanner) on a customer-facing tile — show what it DOES. Honesty
// is preserved: a configured-but-unreachable engine still flags (a real ops problem), while an
// instance with nothing configured reads as a calm "NOT SET", not a red "broken".
function guardrailPosture(g: { engine: string; reachable: boolean; configured: boolean }): {
  value: string;
  hint: string;
  tone: HomeTile['tone'];
} {
  if (g.reachable && g.configured) return { value: 'ACTIVE', hint: 'screening prompts and responses in-line', tone: 'good' };
  if (g.engine === 'regex') return { value: 'BASELINE', hint: 'baseline PII floor active', tone: 'muted' };
  if (g.configured && !g.reachable) return { value: 'OFFLINE', hint: 'guardrail service not responding', tone: 'bad' };
  return { value: 'NOT SET', hint: 'no guardrail endpoint configured', tone: 'muted' };
}
function localShareTone(localShare: number): HomeTile['tone'] {
  if (localShare >= 90) return 'good';
  if (localShare > 0) return 'muted';
  return 'warn';
}

export function synthesizeOperatorHome(input: OperatorHomeInput): OperatorHome {
  const {
    analytics,
    finops,
    policy,
    guardrails,
    audit,
    decisions,
    services,
    activity,
    now,
    connectors = [],
  } = input;
  const windowMs = WINDOW_HOURS * 3_600_000;

  // ---- Cross-module blocking feed (audit ∪ policy ∪ guardrails, last 24h) ----
  const blocking = synthesizeBlocking(audit, decisions, guardrails, analytics, now, windowMs);

  // ---- Governance posture ("is it controlled right now?") ----
  const posture: HomeTile[] = [];
  // Lead tile: the synthesized blocking count — the single number that answers "is anything being
  // stopped right now?". Deep-links to the unified control view.
  posture.push({
    label: 'Blocking decisions (24h)',
    value: blocking.total.toLocaleString(),
    hint: blocking.total > 0 ? blockingBreakdown(blocking.items) : 'nothing stopped — all clear',
    tone: blocking.total > 0 ? 'warn' : 'good',
    href: '/governance',
  });
  if (policy) {
    posture.push({
      label: 'Policy engine',
      value: policy.engine.toUpperCase(),
      hint: policy.reachable ? 'enforcing every request' : 'unreachable — requests uncovered',
      tone: policy.reachable ? 'good' : 'bad',
      href: '/governance/policy',
    });
  }
  if (guardrails) {
    const gp = guardrailPosture(guardrails);
    posture.push({
      label: 'PII guardrails',
      value: gp.value,
      hint: gp.hint,
      tone: gp.tone,
      href: '/governance/guardrails',
    });
  }
  if (analytics) {
    posture.push({
      label: 'Cloud egress',
      value: pct(analytics.egressRate),
      hint: analytics.egressRate > 0 ? 'some data left the box' : 'fully on-prem — nothing left',
      tone: analytics.egressRate > 0 ? 'warn' : 'good',
      href: '/governance',
    });
  }

  // ---- Cost ("what is it costing?") ----
  const cost: HomeTile[] = [];
  if (finops) {
    cost.push({
      label: 'Spend (window)',
      value: `$${finops.totals.costUsd.toFixed(2)}`,
      hint: `${finops.totals.requests.toLocaleString()} requests billed`,
      tone: 'muted',
      href: '/insights/finops',
    });
    // localShare arrives as a whole-number percent (0..100) from finops.
    const localShare = finops.totals.localShare;
    cost.push({
      label: 'On-prem dividend',
      value: `${Math.round(localShare)}%`,
      hint: 'ran free on your own hardware',
      tone: localShare >= 90 ? 'good' : localShare > 0 ? 'muted' : 'warn',
      href: '/insights/finops',
    });
    const overBudget = finops.byKey.filter((k) => k.pct !== null && k.pct >= 100).length;
    cost.push({
      label: 'Keys over budget',
      value: String(overBudget),
      hint:
        overBudget > 0
          ? 'capped — raise the limit or investigate'
          : `${finops.byKey.length} keys within budget`,
      tone: overBudget > 0 ? 'bad' : 'good',
      href: '/insights/finops',
    });
  }

  // ---- Health ("is it up?") ----
  const up = services.filter((s) => s.status === 'up').length;
  const total = services.length;
  const down = total - up;
  let healthTone: 'good' | 'warn' | 'bad' = 'warn';
  if (down === 0) healthTone = 'good';
  else if (down >= total) healthTone = 'bad';
  const health: OperatorHome['health'] = {
    up,
    total,
    tone: healthTone,
    tile: {
      label: 'Core services',
      value: total ? `${up}/${total} up` : '—',
      hint: down === 0 ? 'every service responding' : `${down} not responding`,
      tone: healthTone,
      href: '/gateway/services',
    },
    items: services.map((s) => ({ id: s.id, label: s.label, status: s.status, ms: s.ms })),
  };

  void connectors; // reserved for a future data-source tile; kept in the input for the page.

  return { posture, cost, health, activity, blocking };
}

// ── Blocking-feed synthesis (the cross-module union) ─────────────────────────────────────────────

function synthesizeBlocking(
  audit: AuditRow[],
  decisions: DecisionRow[],
  guardrails: GuardrailsSnapshot | null,
  analytics: AnalyticsSnapshot | null,
  now: number,
  windowMs: number,
): OperatorHome['blocking'] {
  const items: BlockingDecision[] = [];

  // 1) Audit stream: blocked/denied security-audit events (SIEM index).
  for (const e of audit) {
    if (e.outcome !== 'blocked' && e.outcome !== 'denied') continue;
    if (!inWindow(e.ts, now, windowMs)) continue;
    items.push({
      id: `audit:${e.id}`,
      source: 'audit',
      kind: e.outcome,
      title: e.action && e.action !== 'unknown' ? e.action : 'audited request',
      subject: e.detail || e.actor || 'unknown actor',
      ts: e.ts,
      href: `/insights/siem?outcome=${e.outcome}`,
    });
  }

  // 2) Policy engine: denied decisions (OPA/ABAC).
  for (const d of decisions) {
    if (d.allow) continue;
    if (!inWindow(d.timestamp, now, windowMs)) continue;
    items.push({
      id: `policy:${d.id}`,
      source: 'policy',
      kind: 'denied',
      title: 'Policy denied',
      subject: d.path || d.input || 'policy decision',
      ts: d.timestamp,
      href: '/governance/policy',
    });
  }

  // 3) Guardrails: redactions. The audit stream doesn't attribute per-redaction rows, so we surface
  // ONE synthetic rollup entry from the analytics outcomes counter (redacted count in the window)
  // — it tells the operator PII was masked and deep-links to the guardrails module for detail.
  const redactedCount = analytics?.outcomes.redacted ?? 0;
  if (redactedCount > 0) {
    items.push({
      id: 'guardrails:redactions',
      source: 'guardrails',
      kind: 'redacted',
      title: `${redactedCount.toLocaleString()} PII redaction${redactedCount === 1 ? '' : 's'}`,
      subject: guardrails ? `${guardrails.engine} engine masked sensitive data` : 'sensitive data masked',
      ts: '', // rollup, not a single-event timestamp
      href: '/governance/guardrails',
    });
  }

  // Newest-first; the guardrails rollup (no ts) sorts to the end.
  items.sort((a, b) => {
    const ta = parseTs(a.ts);
    const tb = parseTs(b.ts);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return tb - ta;
    if (!Number.isNaN(ta)) return -1;
    if (!Number.isNaN(tb)) return 1;
    return 0;
  });

  return {
    windowHours: WINDOW_HOURS,
    total: items.length,
    items,
    summary: blockingSummary(items),
  };
}

// Count blocking items by source for the posture-tile hint, e.g. "3 policy · 2 audit · 1 redaction".
function blockingBreakdown(items: BlockingDecision[]): string {
  let audit = 0;
  let policy = 0;
  let redactions = 0;
  for (const i of items) {
    if (i.source === 'audit') audit += 1;
    else if (i.source === 'policy') policy += 1;
    else redactions += 1;
  }
  const parts: string[] = [];
  if (policy) parts.push(`${policy} policy`);
  if (audit) parts.push(`${audit} audit`);
  if (redactions) parts.push(`${redactions} redaction${redactions === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

// Outcome-first one-liner for the blocking section header (brand: lead with the result).
function blockingSummary(items: BlockingDecision[]): string {
  if (items.length === 0) return 'Nothing was blocked in the last 24 hours — your controls held with no interventions needed.';
  const n = items.length;
  return `Your controls stopped ${n} risky action${n === 1 ? '' : 's'} in the last 24 hours — ${blockingBreakdown(items)}.`;
}

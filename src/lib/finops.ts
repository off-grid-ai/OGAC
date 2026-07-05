import { gatewayEvents } from '@/lib/analytics';
import { type ApiKey, type AuditEvent, listApiKeys } from '@/lib/store';

// FinOps: metering + cost + usage analytics, computed from the audit/traffic log (the source of
// truth) priced per model. Spend rolls up by model, by virtual key, and by subject (person /
// project), with budget tracking per key. Local models are $0 — the on-device dividend is visible.
const DAY_MS = 86_400_000;

// USD per 1K tokens. Local models cost nothing; cloud models carry a blended rate.
const PRICE_PER_1K: Record<string, number> = {
  'gemma-local': 0,
  'whisper-local': 0,
  'cloud-claude': 0.009,
  'gpt-4o': 0.005,
};
const DEFAULT_CLOUD_PRICE = 0.002;

// Exported for reuse by the accounting rollups (accounting-aggs.ts) so per-model pricing lives in
// ONE place. Adding an export changes no existing behavior — the internal callers below still use it.
export function priceFor(model: string): number {
  if (model in PRICE_PER_1K) return PRICE_PER_1K[model];
  return model.includes('local') ? 0 : DEFAULT_CLOUD_PRICE;
}

// Pure cost from a token count for a model — USD, priced per 1K tokens. Reused by accounting-aggs
// to price aggregation buckets (which carry summed tokens, not per-event AuditEvents).
export function costForTokens(model: string, tokens: number): number {
  return (tokens / 1000) * priceFor(model);
}

// ─── Budget ENFORCEMENT (Phase 0 Tier-0 gap) ──────────────────────────────────
// The single, pure budget decision. Zero I/O — the caller supplies the real spend-so-far (priced
// with the SAME finops rates via costOf/costForTokens) and the incoming call's cost; this decides
// whether the call is admitted. It is the one place the "spend limit" rule lives, so the gate on
// the chat + agent spend paths and the FinOps alert math agree by construction.
//
// This is the SINGLE source of truth for budgets: the `apiKeys.budgetUsd` (whole-USD monthly cap
// per virtual key, scoped to a user/project) metered against real per-model spend from the gateway
// traffic log (priced by `priceFor`). The old chat-governance `withinBudget` (flat blended rate on
// the legacy Postgres audit_events table) is deprecated and now delegates here.
//
// Rules (exhaustive):
//   - limit === null            → no budget set → ALLOW (unlimited)
//   - incomingCost <= 0         → a $0 (local / on-prem) call NEVER exceeds → ALLOW, always. This is
//                                 the on-device dividend: local inference is free and unthrottled.
//   - spent + incomingCost > limit → the call would push spend OVER the cap → DENY.
//   - otherwise (still at/under the cap after this call) → ALLOW.
// A zero-limit ($0 budget) denies the first real-cost call but still lets $0 local calls through.
export type BudgetReason = 'no-limit' | 'within-budget' | 'zero-cost' | 'over-budget';

export interface BudgetDecision {
  allow: boolean;
  reason: BudgetReason;
  spent: number; // spend already billed this period, USD
  limit: number | null; // the cap, USD, or null for unlimited
  incomingCost: number; // priced cost of the call under consideration, USD
}

export function checkBudget(
  spent: number,
  limit: number | null,
  incomingCost: number,
): BudgetDecision {
  const cost = Number.isFinite(incomingCost) ? Math.max(0, incomingCost) : 0;
  const spentSoFar = Number.isFinite(spent) ? Math.max(0, spent) : 0;
  if (limit === null) {
    return { allow: true, reason: 'no-limit', spent: spentSoFar, limit, incomingCost: cost };
  }
  // A $0 call (local / on-prem) can never push spend over any limit — admit it unconditionally,
  // even at a spent-out or zero budget. Only real (cloud) cost is metered against the cap.
  if (cost <= 0) {
    return { allow: true, reason: 'zero-cost', spent: spentSoFar, limit, incomingCost: cost };
  }
  if (spentSoFar + cost > limit) {
    return { allow: false, reason: 'over-budget', spent: spentSoFar, limit, incomingCost: cost };
  }
  return { allow: true, reason: 'within-budget', spent: spentSoFar, limit, incomingCost: cost };
}

function costOf(e: AuditEvent): number {
  return (e.tokens / 1000) * priceFor(e.model);
}

export interface Bucket {
  label: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface KeySpend extends Bucket {
  id: string;
  subjectType: string;
  subject: string;
  budgetUsd: number | null;
  enabled: boolean;
  pct: number | null; // % of budget used
}

export interface FinOps {
  totals: { requests: number; tokens: number; costUsd: number; localShare: number };
  byModel: Bucket[];
  bySubject: Bucket[];
  byKey: KeySpend[];
  daily: { day: string; costUsd: number }[];
}

function bucket(label: string): Bucket {
  return { label, requests: 0, tokens: 0, costUsd: 0 };
}

function add(b: Bucket, e: AuditEvent): void {
  b.requests += 1;
  b.tokens += e.tokens;
  b.costUsd += costOf(e);
}

function round(n: number): number {
  return Number(n.toFixed(4));
}

function group(events: AuditEvent[], keyOf: (e: AuditEvent) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const e of events) {
    const k = keyOf(e);
    if (!map.has(k)) map.set(k, bucket(k));
    add(map.get(k)!, e);
  }
  return [...map.values()]
    .map((b) => ({ ...b, costUsd: round(b.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function keySpend(keys: ApiKey[], events: AuditEvent[]): KeySpend[] {
  const byKey = new Map<string, AuditEvent[]>();
  for (const e of events) {
    if (!e.keyId) continue;
    if (!byKey.has(e.keyId)) byKey.set(e.keyId, []);
    byKey.get(e.keyId)!.push(e);
  }
  return keys.map((k) => {
    const b = bucket(k.name);
    for (const e of byKey.get(k.id) ?? []) add(b, e);
    const cost = round(b.costUsd);
    return {
      ...b,
      costUsd: cost,
      id: k.id,
      subjectType: k.subjectType,
      subject: k.subject,
      budgetUsd: k.budgetUsd,
      enabled: k.enabled,
      pct: k.budgetUsd ? Math.round((cost / k.budgetUsd) * 100) : null,
    };
  });
}

export async function computeFinOps(): Promise<FinOps> {
  // Real gateway traffic (OpenSearch) for cost/usage — not the seeded Postgres audit.
  const [events, keys] = await Promise.all([gatewayEvents(), listApiKeys()]);
  const keyById = new Map(keys.map((k) => [k.id, k]));
  const totalCost = round(events.reduce((a, e) => a + costOf(e), 0));
  const localReq = events.filter((e) => priceFor(e.model) === 0).length;
  const daily = group(events, (e) => e.ts.slice(0, 10))
    .map((b) => ({ day: b.label, costUsd: b.costUsd }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return {
    totals: {
      requests: events.length,
      tokens: events.reduce((a, e) => a + e.tokens, 0),
      costUsd: totalCost,
      localShare: events.length ? Math.round((localReq / events.length) * 100) : 0,
    },
    byModel: group(events, (e) => e.model),
    bySubject: group(
      events.filter((e) => e.keyId),
      (e) => {
        const k = keyById.get(e.keyId!);
        return k ? `${k.subjectType}:${k.subject}` : 'unattributed';
      },
    ),
    byKey: keySpend(keys, events),
    daily,
  };
}

// silence unused DAY_MS if tree-shaken; kept for future windowing
void DAY_MS;

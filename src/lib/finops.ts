import { type ApiKey, type AuditEvent, listApiKeys, listAudit } from '@/lib/store';

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

function priceFor(model: string): number {
  if (model in PRICE_PER_1K) return PRICE_PER_1K[model];
  return model.includes('local') ? 0 : DEFAULT_CLOUD_PRICE;
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
  const [events, keys] = await Promise.all([listAudit({ limit: 5000 }), listApiKeys()]);
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

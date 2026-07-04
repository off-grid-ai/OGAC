// Home overview — the jobs-oriented landing an operator sees first. This is the pure assembler:
// it gathers a snapshot from the existing data functions (analytics, finops, policy, services,
// agent runs, connectors) into one model the page renders. Every section is fault-isolated: if a
// backend service is down, that section degrades to a null/empty value rather than blanking the
// whole home. Zero new storage — this only reads what the platform already computes.
//
// The four sections map to the four consumer jobs in VISION.md:
//   posture  → risk/compliance ("is it controlled?")
//   spend    → finance ("what's it costing?")
//   traffic  → platform ops ("is it healthy?")
//   activity → builders ("what's running?")

import { listAgentRuns } from '@/lib/agentrun';
import { computeAnalytics } from '@/lib/analytics';
import { computeFinOps } from '@/lib/finops';
import { readPolicyStatus } from '@/lib/policy-view';
import { type ServiceHealth, getServices } from '@/lib/services-directory';
import { probeService } from '@/lib/status';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export interface HomeStat {
  label: string;
  value: string;
  hint?: string;
  /** Traffic-light for the operator: good = green, warn = amber, bad = red, muted = neutral. */
  tone: 'good' | 'warn' | 'bad' | 'muted';
  /** Where clicking drills in. */
  href: string;
}

export interface HomeService {
  id: string;
  label: string;
  status: 'up' | 'down';
  ms: number | null;
}

export interface HomeActivity {
  id: string;
  agentId: string;
  query: string;
  status: string;
  startedAt: string;
}

export interface HomeOverview {
  posture: HomeStat[];
  spend: HomeStat[];
  traffic: HomeStat[];
  services: { up: number; total: number; items: HomeService[] };
  activity: HomeActivity[];
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Probe only the core on-prem services on the home page — keep it fast and legible. The full
// service directory + per-service detail lives on the Services module.
const HOME_SERVICE_IDS = ['gateway', 'langfuse', 'presidio', 'keycloak', 'openbao', 'qdrant'];

export async function buildHomeOverview(): Promise<HomeOverview> {
  const org = await safe(() => currentOrgId(), 'org_default');

  const [analytics, finops, policy, runs, connectors, services] = await Promise.all([
    safe(() => computeAnalytics(), null),
    safe(() => computeFinOps(), null),
    safe(() => readPolicyStatus(), null),
    safe(() => listAgentRuns(6, org), []),
    safe(() => listConnectors(org), []),
    probeHomeServices(),
  ]);

  // ---- Governance posture (compliance officer) ----
  const posture: HomeStat[] = [];
  if (policy) {
    posture.push({
      label: 'Policy engine',
      value: policy.engine.toUpperCase(),
      hint: policy.reachable ? 'reachable' : 'unreachable',
      tone: policy.reachable ? 'good' : 'bad',
      href: '/policy',
    });
  }
  if (analytics) {
    const { blocked, redacted, ok } = analytics.outcomes;
    const guarded = blocked + redacted;
    posture.push({
      label: 'Guardrail actions',
      value: guarded.toLocaleString(),
      hint: `${blocked} blocked · ${redacted} redacted · ${ok} clean`,
      tone: guarded > 0 ? 'warn' : 'good',
      href: '/guardrails',
    });
    posture.push({
      label: 'Cloud egress',
      value: pct(analytics.egressRate),
      hint: analytics.egressRate > 0 ? 'data left the box' : 'fully on-prem',
      tone: analytics.egressRate > 0 ? 'warn' : 'good',
      href: '/control',
    });
  }

  // ---- Spend (finance) ----
  const spend: HomeStat[] = [];
  if (finops) {
    spend.push({
      label: 'Spend (window)',
      value: `$${finops.totals.costUsd.toFixed(2)}`,
      hint: `${finops.totals.requests.toLocaleString()} requests`,
      tone: 'muted',
      href: '/finops',
    });
    spend.push({
      label: 'On-prem share',
      value: pct(finops.totals.localShare),
      hint: 'run at $0 on your hardware',
      tone: finops.totals.localShare >= 0.9 ? 'good' : 'muted',
      href: '/finops',
    });
    const overBudget = finops.byKey.filter((k) => k.pct !== null && k.pct >= 100).length;
    spend.push({
      label: 'Keys over budget',
      value: String(overBudget),
      hint: `${finops.byKey.length} virtual keys`,
      tone: overBudget > 0 ? 'bad' : 'good',
      href: '/finops',
    });
  }

  // ---- Traffic / health (platform ops) ----
  const traffic: HomeStat[] = [];
  if (analytics) {
    traffic.push({
      label: 'Requests (window)',
      value: analytics.totalEvents.toLocaleString(),
      hint: `${analytics.totalTokens.toLocaleString()} tokens`,
      tone: 'muted',
      href: '/analytics',
    });
    traffic.push({
      label: 'Latency p95',
      value: `${Math.round(analytics.p95)} ms`,
      hint: `p50 ${Math.round(analytics.p50)} ms`,
      tone: analytics.p95 > 8000 ? 'warn' : 'good',
      href: '/observability',
    });
  }
  traffic.push({
    label: 'Data sources',
    value: String(connectors.length),
    hint: `${connectors.filter((c) => c.status === 'connected').length} connected`,
    tone: connectors.some((c) => c.status === 'error') ? 'warn' : 'muted',
    href: '/integrations',
  });

  return {
    posture,
    spend,
    traffic,
    services,
    activity: runs.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      query: r.query,
      status: r.status,
      startedAt: r.startedAt,
    })),
  };
}

async function probeHomeServices(): Promise<HomeOverview['services']> {
  const entries = getServices().filter((s) => HOME_SERVICE_IDS.includes(s.id));
  const results = await Promise.all(
    entries.map(async (s) => {
      const h: Omit<ServiceHealth, 'id'> = await safe(
        () => probeService(s.url, s.healthPath, 3000),
        { status: 'down', httpStatus: null, ms: null },
      );
      return { id: s.id, label: s.label, status: h.status, ms: h.ms };
    }),
  );
  return {
    up: results.filter((r) => r.status === 'up').length,
    total: results.length,
    items: results,
  };
}

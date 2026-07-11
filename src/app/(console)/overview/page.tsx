import {
  ChatCircle,
  Database,
  FileText,
  Plus,
  ShieldCheck,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { auth } from '@/auth';
import { listAgentRuns } from '@/lib/agentrun';
import { computeAnalytics } from '@/lib/analytics';
import { computeFinOps } from '@/lib/finops';
import { readGuardrailsView } from '@/lib/guardrails-view';
import { type OperatorHomeInput, synthesizeOperatorHome } from '@/lib/overview-synthesis';
import { readDecisions, readPolicyStatus } from '@/lib/policy-view';
import { type RawProbe, getServices } from '@/lib/services-directory';
import { readSiemView } from '@/lib/siem-view';
import { probeService } from '@/lib/status';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { safeWithTimeout } from '@/lib/with-timeout';
import {
  ActivityCard,
  BlockingFeed,
  Section,
  ServicesCard,
  TileCard,
} from './overview-components';

// Overview — the jobs-oriented operator home (VISION Pillar 4). This page is the THIN I/O shell:
// it fetches the real module snapshots server-side (each fault-isolated so one dead service can't
// blank the home), then hands them to the PURE synthesizer in src/lib/overview-synthesis.ts, which
// cross-references audit + policy + guardrails + finops + health + runs into one operator-home
// view-model. Rendering lives in ./overview-components. Zero business logic here — that's the SOLID
// seam (mirrors tenancy.ts → tenancy-policy.ts): I/O here, the rule there, both testable apart.

export const dynamic = 'force-dynamic';

// Per-probe wall-clock ceiling for the home. Each snapshot below has its own internal fetch timeout
// (some as loose as 6s), and this page runs eight of them; a single slow backend used to drag the
// whole home render past the 1s "instant" bar. `safe()` now delegates to `safeWithTimeout`, so any
// probe that exceeds PROBE_TIMEOUT_MS degrades to its fallback tile instead of stalling first paint
// — the same graceful-degrade contract as before (catch → fallback), now also covering hangs, not
// just throws. The `loading.tsx` skeleton covers the render up to this ceiling.
const PROBE_TIMEOUT_MS = 1500;

function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  return safeWithTimeout(fn, PROBE_TIMEOUT_MS, fallback);
}

// Probe only the core on-prem services on the home — fast and legible. The full directory lives on
// the Services module.
const HOME_SERVICE_IDS = new Set([
  'gateway',
  'langfuse',
  'presidio',
  'keycloak',
  'openbao',
  'qdrant',
  'opa',
]);

async function probeHomeServices() {
  const entries = getServices().filter((s) => HOME_SERVICE_IDS.has(s.id));
  return Promise.all(
    entries.map(async (s) => {
      const h: RawProbe = await safe(
        () => probeService(s.url, s.healthPath, 3000),
        { status: 'down' as const, httpStatus: null, ms: null },
      );
      return { id: s.id, label: s.label, status: h.status, ms: h.ms };
    }),
  );
}

const QUICK_ACTIONS = [
  { label: 'Open chat', href: '/workspace/chat', icon: ChatCircle },
  { label: 'Add data source', href: '/data/integrations', icon: Plus },
  { label: 'Review policy', href: '/governance/policy', icon: ShieldCheck },
  { label: 'Add knowledge', href: '/workspace/knowledge', icon: Database },
  { label: 'Generate report', href: '/insights/reports', icon: FileText },
];

export default async function ConsoleHome() {
  const session = await auth();
  const org = await safe(() => currentOrgId(), 'org_default');

  // Fetch every module snapshot the synthesizer cross-references — all in parallel, all fault-
  // isolated to a safe fallback so a single unreachable backend degrades one tile, not the page.
  const [analytics, finops, policy, guardrails, siem, decisions, runs, connectors, services] =
    await Promise.all([
      safe(() => computeAnalytics(), null),
      safe(() => computeFinOps(), null),
      safe(() => readPolicyStatus(), null),
      safe(() => readGuardrailsView(), null),
      safe(() => readSiemView(500), null),
      safe(() => readDecisions(), []),
      safe(() => listAgentRuns(6, org), []),
      safe(() => listConnectors(org), []),
      probeHomeServices(),
    ]);

  const input: OperatorHomeInput = {
    analytics,
    finops: finops
      ? {
          totals: finops.totals,
          byKey: finops.byKey.map((k) => ({ label: k.label, pct: k.pct, budgetUsd: k.budgetUsd })),
        }
      : null,
    policy: policy ? { engine: policy.engine, reachable: policy.reachable } : null,
    guardrails: guardrails
      ? {
          engine: guardrails.engine,
          reachable: guardrails.reachable,
          configured: guardrails.configured,
        }
      : null,
    audit: (siem?.data.events ?? []).map((e) => ({
      id: e.id,
      ts: e.ts,
      actor: e.actor,
      action: e.action,
      outcome: e.outcome,
      detail: e.detail,
    })),
    decisions: decisions.map((d) => ({
      id: d.id,
      allow: d.allow,
      path: d.path,
      input: d.input,
      timestamp: d.timestamp,
    })),
    services,
    activity: runs.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      query: r.query,
      status: r.status,
      startedAt: r.startedAt,
    })),
    connectors: connectors.map((c) => ({ status: c.status })),
    now: Date.now(),
  };

  const home = synthesizeOperatorHome(input);
  const firstName = session?.user?.name?.split(' ')[0] ?? session?.user?.email?.split('@')[0];

  return (
    <div className="mx-auto max-w-[110rem] space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {firstName ? `Welcome back, ${firstName}` : 'Overview'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything your platform is doing right now — what it stopped, what it cost, and whether
          it&apos;s healthy — in one place, so you can run it without digging through five modules.
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <a.icon className="size-4" />
            {a.label}
          </Link>
        ))}
      </div>

      {/* Governance posture — the synthesized "is it controlled right now?" answer */}
      {home.posture.length > 0 ? (
        <Section title="Governance posture" href="/governance" linkLabel="Governance">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {home.posture.map((t) => (
              <TileCard key={t.label} t={t} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* The cross-module blocking feed: audit ∪ policy ∪ guardrails, last 24h */}
      <BlockingFeed blocking={home.blocking} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {home.cost.length > 0 ? (
          <Section title="Cost" href="/insights/finops" linkLabel="FinOps">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {home.cost.map((t) => (
                <TileCard key={t.label} t={t} />
              ))}
            </div>
          </Section>
        ) : null}

        <Section
          title={`Services (${home.health.up}/${home.health.total} up)`}
          href="/gateway/services"
          linkLabel="All services"
        >
          <ServicesCard health={home.health} />
        </Section>
      </div>

      {/* Recent activity */}
      <Section title="Recent activity" href="/build/agent-runs" linkLabel="All runs">
        <ActivityCard activity={home.activity} />
      </Section>
    </div>
  );
}

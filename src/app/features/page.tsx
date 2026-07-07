import type { Icon } from '@phosphor-icons/react';
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Broadcast,
  ChartLineUp,
  Coins,
  Cube,
  Database,
  Gauge,
  Lock,
  Plugs,
  Robot,
  Scroll,
  SealCheck,
  ShieldCheck,
  Stack,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { MagicCard } from '@/components/ui/magic-card';

export const dynamic = 'force-dynamic';

// ─── Content ────────────────────────────────────────────────────────────────
interface Feature {
  name: string;
  value: string;
}
interface FeatureGroup {
  icon: Icon;
  layer: string;
  title: string;
  tagline: string;
  features: Feature[];
}

const GROUPS: FeatureGroup[] = [
  {
    icon: ShieldCheck,
    layer: 'Control',
    title: 'One gateway every AI call passes through',
    tagline: 'The chokepoint that ends Shadow AI and makes everything else governable.',
    features: [
      { name: 'AI Gateway', value: 'A single, OpenAI-compatible endpoint for every model call — one place to route, govern, observe, and kill.' },
      { name: 'Guardrails (PII + injection)', value: 'Every prompt is scanned for sensitive data and prompt-injection before it ever reaches a model.' },
      { name: 'Policy — RBAC + ABAC / OPA', value: 'Deny-overrides access decisions: who can use which model, data, and tool, provably enforced.' },
      { name: 'Identity & SSO', value: 'Google / Microsoft / Keycloak (SAML/OIDC). Enterprise login with no bespoke user store.' },
      { name: 'Secrets management', value: 'Env by default, OpenBao for production — no plaintext keys anywhere, rotated centrally.' },
      { name: 'Append-only audit + SIEM', value: 'Every model call, tool call, and byte of egress on one immutable record; ship to OpenSearch for search + dashboards.' },
      { name: 'Kill switch', value: 'One control halts all AI org-wide — the switch a board signs off on.' },
    ],
  },
  {
    icon: Brain,
    layer: 'AI',
    title: 'Your knowledge, grounded and cited',
    tagline: 'Agents answer from your content — not the model’s guesses.',
    features: [
      { name: 'The Brain (RAG)', value: 'Versioned knowledge base over your own SOPs/playbooks; LanceDB on-disk, Qdrant/pgvector at scale.' },
      { name: 'Retrieval router', value: 'Detects intent and queries the right source — knowledge base, database, or tool — with provenance on every hit.' },
      { name: 'Grounding & citation checks', value: 'Verifies each claim against its sources, so hallucination is caught before it ships.' },
      { name: 'Response cache', value: 'Exact + semantic caching (in-process or Redis) cuts cost and latency on repeated prompts.' },
      { name: 'Model routing', value: 'Smart, conditional, and geo-aware routing across models with a cloud leash you control.' },
    ],
  },
  {
    icon: Gauge,
    layer: 'Agent QA',
    title: 'Proof the agents are still doing a good job',
    tagline: 'Automated QA that answers: are they working, and if not, which one regressed and when?',
    features: [
      { name: 'Offline evals', value: 'Golden-set recall plus promptfoo assertion matrices and Ragas RAG metrics — regression-test agents before release.' },
      { name: 'Online scoring', value: 'An LLM-as-judge scores live traffic for quality + faithfulness and trends it in Langfuse — a falling score is your alarm.' },
      { name: 'Drift & degradation', value: 'Population-stability + Evidently test suites detect distribution shift and quality decay over time.' },
      { name: 'Live observability', value: 'OpenTelemetry traces, metrics, and per-call cost per user / team / project.' },
    ],
  },
  {
    icon: SealCheck,
    layer: 'Trust',
    title: 'Tamper-evident, provable outputs',
    tagline: 'Prove what was produced, by whom, unaltered.',
    features: [
      { name: 'Signed exports', value: 'Every report carries a detached ed25519 manifest — offline-verifiable with only a public key, no shared secret.' },
      { name: 'C2PA Content Credentials', value: 'Industry-standard signed manifests embedded in generated images.' },
      { name: 'Sigstore attestation', value: 'Keyless signing of artifacts with a public transparency-log trail.' },
      { name: 'Data lineage', value: 'A queryable source → chunk → answer graph (OpenLineage / Marquez) explains where any answer came from.' },
    ],
  },
  {
    icon: Cube,
    layer: 'Autonomy',
    title: 'Run agents — safely and durably',
    tagline: 'The substrate for agents that act, not just answer.',
    features: [
      { name: 'Sandboxed code execution', value: 'Agent-authored code runs in an ephemeral, network-isolated, resource-capped container — off by default, gated by policy.' },
      { name: 'Durable workflows', value: 'Temporal-backed multi-step agents survive a crash and resume — required before you trust autonomy.' },
      { name: 'Tool registry', value: 'Agents call only registered, scoped tools — arbitrary action is refused by default.' },
      { name: 'Feature flags', value: 'Toggle modules and capabilities per tenant / environment; instant rollback.' },
    ],
  },
  {
    icon: Scroll,
    layer: 'Regulatory',
    title: 'Defensible to a regulator and a board',
    tagline: 'Turn the audit trail into the documents they actually ask for.',
    features: [
      { name: 'Report packs', value: 'IRDAI / RBI / SEBI / DPDP-aligned report packs generated from the audit record.' },
      { name: 'Governance registry & DPIA', value: 'Model risk becomes a tracked, board-level line item.' },
      { name: 'Multi-tenant + data residency', value: 'Per-tenant isolation and on-prem deployment keep data where the law requires.' },
    ],
  },
  {
    icon: Broadcast,
    layer: 'Consumption',
    title: 'One pane of glass over the whole estate',
    tagline: 'Where humans meet the agents — and where you keep control.',
    features: [
      { name: 'Fleet control (FleetDM)', value: '“MDM for AI” on open source — FleetDM + osquery: provision, govern, and observe every AI-enabled device from one console.' },
      { name: 'FinOps + virtual keys', value: 'Issue keys with budgets; per-user / project cost and chargeback — no surprise token bills.' },
      { name: 'BI / data exploration', value: 'Explore usage and data with Superset — without exporting it.' },
      { name: 'Agents & Reports', value: 'Pre-built use cases (claims/FNOL, KYC, SOP synthesis) ready to run and govern.' },
    ],
  },
];

const UNLOCKS: string[] = [
  'Give every employee sanctioned AI — so they stop pasting company data into consumer chatbots.',
  'Stand up a governed RAG agent grounded in your own playbooks, with verified citations, in days.',
  'See and cap AI spend per person, team, and project — and charge it back.',
  'Prove to an auditor exactly what an agent did, on what data, and that the output is unaltered.',
  'Catch a degrading agent automatically — before a customer or regulator does.',
  'Let agents run code and multi-step workflows without handing them your production host.',
  'Swap any underlying tool with one environment variable — never locked to a vendor.',
];

interface Angle {
  icon: Icon;
  title: string;
  body: string;
}

const FIELD_FORCE: Angle[] = [
  {
    icon: UsersThree,
    title: 'Every rep carries your best rep',
    body: 'A private, on-device copilot grounded in your winning playbooks and SOPs — so a 10,000-person field force sells and serves with your top performers’ know-how, not generic model output.',
  },
  {
    icon: Broadcast,
    title: 'Govern thousands of edge devices from one screen',
    body: 'Push policy down, pull audit up, and kill-switch on demand across the whole fleet. Your workforce runs AI on their devices; you keep visibility and control of every call and every byte that leaves.',
  },
  {
    icon: Lock,
    title: 'Data stays where it should',
    body: 'On-device processing and on-prem deployment mean customer data — KYC, claims, PII — never leaves your control. Capture is explicit opt-in, with a visible recording indicator.',
  },
  {
    icon: Coins,
    title: 'Predictable cost, no per-seat AI tax',
    body: 'All open source, self-hosted: no per-token fees to a vendor, no per-user AI licence. You meter and budget usage yourself; spend is a line item you control, not a surprise invoice.',
  },
];

const AGENTIFY: Angle[] = [
  {
    icon: Robot,
    title: 'From copilots to autonomous workflows',
    body: 'Start with one human-in-the-loop agent on the gateway; graduate to durable, multi-step workflows (Temporal) that survive crashes and resume — majority-machine, humans only on the edges that matter.',
  },
  {
    icon: Brain,
    title: 'One organizational brain every agent shares',
    body: 'New agents inherit the same versioned knowledge, tool registry, and policy — so the second agent ships in weeks, not months, reusing everything that already passed production.',
  },
  {
    icon: Gauge,
    title: 'Trust that scales with autonomy',
    body: 'As agents act more independently, evals, online scoring, drift detection, sandboxing, and signed provenance keep every step measurable, reversible, and explainable.',
  },
  {
    icon: ChartLineUp,
    title: 'A maturity path, not a moonshot',
    body: 'Six stages from Shadow AI to an org-wide, self-serve platform — each stage earns the next. You always know where you are and what the next safe step is.',
  },
];

const GUARANTEES: Angle[] = [
  { icon: Lock, title: 'Local-first', body: 'Runs on your infrastructure; models on-device, data in your control.' },
  { icon: Plugs, title: 'No lock-in', body: 'Permissive open source behind swappable ports — change any tool via one env var.' },
  { icon: Coins, title: 'No vendor fees', body: 'All-in-one OSS: no per-token fees, no API keys, no per-seat AI licence.' },
  { icon: ShieldCheck, title: 'Auditable & compliant', body: 'Append-only audit, ABAC, signed exports, and regulator report packs.' },
];

// ─── Render helpers ───────────────────────────────────────────────────────────
function GroupCard({ g }: { g: FeatureGroup }) {
  return (
    <BlurFade inView>
      <MagicCard className="h-full rounded-xl border border-border p-6">
        <div className="flex items-center gap-3">
          <g.icon className="size-6 text-primary" weight="duotone" />
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {g.layer}
          </Badge>
        </div>
        <h3 className="mt-3 text-lg font-semibold tracking-tight">{g.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{g.tagline}</p>
        <ul className="mt-4 space-y-3">
          {g.features.map((f) => (
            <li key={f.name} className="text-sm">
              <span className="font-medium text-foreground">{f.name}</span>
              <span className="text-muted-foreground"> — {f.value}</span>
            </li>
          ))}
        </ul>
      </MagicCard>
    </BlurFade>
  );
}

function AngleCard({ a }: { a: Angle }) {
  return (
    <BlurFade inView>
      <MagicCard className="h-full rounded-xl border border-border p-5">
        <a.icon className="size-5 text-primary" weight="duotone" />
        <h3 className="mt-3 text-sm font-semibold">{a.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>
      </MagicCard>
    </BlurFade>
  );
}

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Off Grid AI Console
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/journey">The journey</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/fleet">Open console</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Stack className="mr-1 size-3.5" />
              The complete feature set
            </Badge>
            <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
              Everything you need to <span className="text-primary">see, govern, prove, and run</span>{' '}
              AI agents across your enterprise.
            </h1>
            <p className="mt-4 max-w-2xl text-base text-muted-foreground">
              Off Grid AI Console is the all-in-one control plane for agentic AI — every layer of the
              stack on one console, on your own infrastructure, entirely open source. No per-token
              fees, no API keys, no lock-in.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/fleet">
                  Open the console
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/fleet-control">Fleet Control</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/journey">See the maturity journey</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/handbook">Read the handbook</Link>
              </Button>
            </div>
          </BlurFade>
        </div>
      </section>

      {/* Feature catalog */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <h2 className="text-2xl font-semibold tracking-tight">Every capability, by layer</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Seven groups, every box a real, named component with a first-party default and
              open-source swap-ins. This is the whole agentic stack — unified under one console.
            </p>
          </BlurFade>
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {GROUPS.map((g) => (
              <GroupCard key={g.title} g={g} />
            ))}
          </div>
        </div>
      </section>

      {/* What you unlock */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <h2 className="text-2xl font-semibold tracking-tight">What it unlocks</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Concrete outcomes, not features for their own sake.
            </p>
          </BlurFade>
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {UNLOCKS.map((u) => (
              <BlurFade key={u} inView>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-4">
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p className="text-sm text-foreground">{u}</p>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* CIO with a field force */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <UsersThree className="mr-1 size-3.5" />
              If you’re a CIO with a field force
            </Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Arm a distributed workforce with AI — without losing control of it
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Thousands of reps, agents, and edge devices, each running AI on customer data. Off Grid AI
              Console is how you give them that power and stay accountable for every call.
            </p>
          </BlurFade>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FIELD_FORCE.map((a) => (
              <AngleCard key={a.title} a={a} />
            ))}
          </div>
        </div>
      </section>

      {/* Agentify your company */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Robot className="mr-1 size-3.5" />
              If you want to agentify your company
            </Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Go from Shadow AI to an org-wide, autonomous AI estate
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Not a moonshot — a path. Each capability earns more autonomy, with the guardrails,
              QA, and provenance to make machine-run work trustworthy.
            </p>
          </BlurFade>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {AGENTIFY.map((a) => (
              <AngleCard key={a.title} a={a} />
            ))}
          </div>
          <div className="mt-8">
            <Button asChild variant="outline">
              <Link href="/journey">
                Walk the six-stage journey
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Guarantees */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-xl font-semibold tracking-tight">The guarantees underneath all of it</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GUARANTEES.map((g) => (
              <AngleCard key={g.title} a={g} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            One control plane for every AI agent you run.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Own it end to end — on your infrastructure, on open source, with nothing routed through a
            server we own.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href="/fleet">
                Open the console
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/handbook/catalog">Browse every component</Link>
            </Button>
          </div>
          <BorderBeam duration={12} size={300} colorFrom="#34d399" colorTo="#059669" />
        </div>
      </section>
    </div>
  );
}

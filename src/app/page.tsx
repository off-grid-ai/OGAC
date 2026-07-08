import {
  ArrowRight,
  Code,
  Database,
  GitBranch,
  Gauge,
  Lock,
  PlugsConnected,
  Robot,
  Scroll as ScrollText,
  SealCheck,
  ShieldCheck,
  Sparkle,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MagicCard } from '@/components/ui/magic-card';
import { Marquee } from '@/components/ui/marquee';
import { Particles } from '@/components/ui/particles';
import { INTEGRATIONS } from '@/lib/integrations';
import { MODULE_ICONS } from '@/modules/icons';
import { MODULES } from '@/modules/registry';

// The spine — how work flows through the platform: data → gateway → pipelines → apps | agents.
const SPINE = [
  {
    icon: Database,
    step: 'Data',
    title: 'One governed source of truth',
    body: 'Connect the systems you already run and pull them into one governed source of truth — so every decision downstream runs on complete, current, permissioned data, not a stale export.',
  },
  {
    icon: PlugsConnected,
    step: 'Gateway',
    title: 'One smart gateway',
    body: 'Every model call — on your own hardware or the cloud — routes through a single gateway: observed, cost-tracked, rate-limited, with an egress leash you decide. One place to see where your AI spend and risk actually live.',
  },
  {
    icon: GitBranch,
    step: 'Pipelines',
    title: 'Governance travels with the work',
    body: 'Guardrails, redaction, evals, and provenance are built into reusable, composable pipelines — inherited by everything you build, never bolted on after. Solve reliability and security once, at the pipeline, not in every project.',
  },
  {
    icon: Robot,
    step: 'Apps & agents',
    title: 'Put to work',
    body: 'Consume a governed pipeline as an app with a human in the loop, or an agent that runs on its own and reports back — driven by real triggers and real tools.',
  },
];

// The unlock — anyone builds.
const UNLOCK = [
  {
    icon: Sparkle,
    title: 'Describe it in plain language',
    body: 'A person on your finance, claims, or lending team writes what the work is — no engineer, no code.',
  },
  {
    icon: ShieldCheck,
    title: 'It inherits your governance',
    body: 'The automation is born on a pipeline: your rules, your connectors, your data, your guardrails — governed by construction.',
  },
  {
    icon: Robot,
    title: 'It runs — overseen or autonomous',
    body: 'Ships as an app a person approves, or an agent that runs on a schedule and reports back. Same people, far more done.',
  },
];

// Governed by construction — the trust spine every pipeline carries.
const GOVERNANCE = [
  {
    icon: ShieldCheck,
    title: 'Guardrails & redaction',
    body: 'Prompt-injection, toxicity, and schema checks on every call — and PII masked before the model ever sees it, enforced, not suggested.',
  },
  {
    icon: Gauge,
    title: 'Evals, faithfulness & drift',
    body: 'Offline evals, live scoring on real traffic, and drift detection — so you know the agents still do a good job, and catch the one that regressed and when.',
  },
  {
    icon: SealCheck,
    title: 'Signed provenance',
    body: 'Every output carries a signed, offline-verifiable record (ed25519); images get C2PA Content Credentials. Prove what was produced, by whom, unaltered — with only a public key.',
  },
  {
    icon: ScrollText,
    title: 'Durable & auditable',
    body: 'Runs survive restarts and resume where they left off. Every model call, tool call, and byte of egress is logged — a record you can hand a regulator.',
  },
];

// On your terms — the non-negotiables.
const PILLARS = [
  {
    icon: Lock,
    title: 'On-prem & yours',
    body: 'Runs on your own infrastructure. Models can run on-device; your data never leaves your control.',
  },
  {
    icon: PlugsConnected,
    title: 'Drop-in',
    body: 'Works with the systems you already run, as-is. No rip-and-replace — connect what you have and make it intelligent.',
  },
  {
    icon: Code,
    title: 'Open & transparent',
    body: 'Open source, so anyone can inspect and trust it. Every AI action is observable, attributable, and reversible.',
  },
  {
    icon: UsersThree,
    title: 'For everyone',
    body: 'Accessible to every employee, not just engineers — the whole workforce builds, safely, inside the same guardrails.',
  },
];

const ALL_TOOLS = INTEGRATIONS.flatMap((l) => l.tools);

function Nav() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <Image src="/logo.png" alt="Off Grid AI" width={26} height={26} priority />
          <span className="whitespace-nowrap text-sm font-medium text-foreground">
            Off Grid AI Console
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href="/docs" target="_blank" rel="noopener noreferrer">
              <Code className="size-4" />
              <span className="hidden sm:inline">API docs</span>
            </a>
          </Button>
          <Button asChild size="sm">
            <Link href="/overview">Open console</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />

      {/* Hero */}
      <section
        className="relative overflow-hidden border-b border-border"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% -10%, rgba(5,150,105,0.10), transparent 55%)',
        }}
      >
        <Particles className="absolute inset-0" quantity={90} ease={70} color="#059669" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 py-24 text-center">
          <BlurFade delay={0.05} inView>
            <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm">
              <AnimatedShinyText>On your infrastructure · open source · yours</AnimatedShinyText>
            </div>
          </BlurFade>
          <BlurFade delay={0.15} inView>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Become an intelligent enterprise, without compromising.
            </h1>
          </BlurFade>
          <BlurFade delay={0.3} inView>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
              Aggregate your data into one governed source of truth, put one smart gateway in front
              of every model, and let anyone turn the work they already do into a governed app or
              agent — in plain language. Your data stays yours. You keep control. And you can prove
              it.
            </p>
          </BlurFade>
          <BlurFade delay={0.45} inView>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/overview">
                  Open console
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/signin">Book a call</Link>
              </Button>
            </div>
          </BlurFade>
          <BlurFade delay={0.55} inView>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5 text-primary" /> On-prem
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-primary" /> Every call policy-checked
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Code className="size-3.5 text-primary" /> Open source
              </span>
            </div>
          </BlurFade>
        </div>
      </section>

      {/* The spine — data → gateway → pipelines → apps | agents */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              Data → Gateway → Pipelines → Apps &amp; Agents
            </p>
            <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
              One governed path, end to end
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Every part of the AI problem — data, model access, governance, delivery — solved once,
              in one place, so the work is reliable and compliant by default.
            </p>
          </BlurFade>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SPINE.map((s, i) => (
              <BlurFade key={s.step} delay={0.06 * i} inView>
                <MagicCard
                  gradientFrom="#34d399"
                  gradientTo="#059669"
                  gradientColor="rgba(52,211,153,0.12)"
                  gradientOpacity={0.5}
                  className="h-full rounded-xl border border-border p-6 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <s.icon className="size-5" />
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {s.step}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
                </MagicCard>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* The unlock — anyone builds */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">The unlock</p>
            <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Anyone builds. Everything stays governed.
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Not another tool for engineers. A person describes the process they run today in plain
              language and gets back a working, governed automation — your own build-anything studio
              that inherits your rules, connectors, and data. You&apos;re not speeding up a few
              engineers; you&apos;re giving every employee an agent workforce, safe by construction.
            </p>
          </BlurFade>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {UNLOCK.map((u, i) => (
              <BlurFade key={u.title} delay={0.06 * i} inView>
                <div className="h-full rounded-xl border border-border bg-background p-6 shadow-sm">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <u.icon className="size-5" />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <span className="font-mono text-xs text-primary">{i + 1}</span>
                    <h3 className="text-base font-semibold text-foreground">{u.title}</h3>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{u.body}</p>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* Governed by construction */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Governed</p>
            <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Governed by construction, not by review
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              The trust spine every pipeline carries — so autonomy never means losing control, and
              compliance isn&apos;t a meeting three weeks later.
            </p>
          </BlurFade>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GOVERNANCE.map((g, i) => (
              <BlurFade key={g.title} delay={0.06 * i} inView>
                <MagicCard
                  gradientFrom="#34d399"
                  gradientTo="#059669"
                  gradientColor="rgba(52,211,153,0.12)"
                  gradientOpacity={0.5}
                  className="h-full rounded-xl border border-border p-6 shadow-sm"
                >
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <g.icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground">{g.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{g.body}</p>
                </MagicCard>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* On your terms */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">On your terms</p>
            <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Intelligence that works the way you already do
            </h2>
          </BlurFade>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((p, i) => (
              <BlurFade key={p.title} delay={0.06 * i} inView>
                <Card className="h-full shadow-sm">
                  <CardHeader className="pb-2">
                    <p.icon className="size-5 text-primary" />
                    <CardTitle className="mt-2 text-sm">{p.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">{p.body}</CardContent>
                </Card>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities — the planes, adoptable on their own */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <BlurFade inView>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Capabilities</p>
          <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything the estate needs, in one console
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            From ingestion to consumption to the regulatory wrapper. Each capability is API-first and
            adoptable on its own — take the whole platform, or start with one and add the rest when
            you&apos;re ready.
          </p>
        </BlurFade>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((m) => !m.internal).map((m, i) => {
            const Icon = MODULE_ICONS[m.id];
            return (
              <BlurFade key={m.id} delay={0.03 * i} inView>
                <MagicCard
                  gradientFrom="#34d399"
                  gradientTo="#059669"
                  gradientColor="rgba(52,211,153,0.12)"
                  gradientOpacity={0.5}
                  className="h-full rounded-xl border border-border p-5 shadow-sm transition-transform duration-200 hover:-translate-y-1"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </div>
                    <span className="text-sm font-medium text-foreground">{m.label}</span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{m.description}</p>
                </MagicCard>
              </BlurFade>
            );
          })}
        </div>
      </section>

      {/* Under the hood — one architecture exhibit for the technical buyer */}
      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Under the hood</p>
            <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
              A complete, governed AI estate
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              The reference architecture for production AI — data plane, model plane, control plane,
              consumption, and the org &amp; regulatory wrapper — and exactly how Off Grid AI maps
              onto it.
            </p>
          </BlurFade>
          <BlurFade inView>
            <div className="relative mt-8 overflow-hidden rounded-xl border border-border bg-[#ffffff] p-3 shadow-sm">
              <Image
                src="/diagrams/01-full-architecture.jpg"
                alt="Full governed AI architecture"
                width={1376}
                height={768}
                className="h-auto w-full rounded-lg"
                priority
              />
              <BorderBeam duration={10} size={340} colorFrom="#34d399" colorTo="#059669" />
            </div>
          </BlurFade>
        </div>
      </section>

      {/* Open foundations */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Open</p>
            <h2 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Open foundations, no lock-in
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              We stand on open standards and the best of the open ecosystem, woven into one governed
              platform — so you can inspect every layer, trust it, and run it yourself. Nothing to be
              locked into.
            </p>
          </BlurFade>
          <div className="relative mt-8 flex flex-col gap-3 overflow-hidden">
            <Marquee pauseOnHover className="[--duration:45s] [--gap:0.6rem]">
              {ALL_TOOLS.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
                >
                  {t}
                </span>
              ))}
            </Marquee>
            <Marquee reverse pauseOnHover className="[--duration:45s] [--gap:0.6rem]">
              {ALL_TOOLS.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
                >
                  {t}
                </span>
              ))}
            </Marquee>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-background to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-background to-transparent" />
          </div>
        </div>
      </section>

      {/* Close */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <BlurFade inView>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Become an intelligent enterprise — on your own grid.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              Open the console and see it running, or book a call and we&apos;ll walk your team
              through it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/overview">
                  Open console
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/signin">Book a call</Link>
              </Button>
            </div>
          </BlurFade>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-xs text-muted-foreground">
          <span>Off Grid AI · a private AI, everywhere — on your infrastructure</span>
          <span>AGPL-3.0 · your data, your control</span>
        </div>
      </footer>
    </div>
  );
}

import {
  ArrowRight,
  Code,
  Database,
  GitBranch,
  Gauge,
  PlugsConnected,
  Robot,
  ShieldCheck,
} from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { MagicCard } from '@/components/ui/magic-card';
import { Marquee } from '@/components/ui/marquee';
import { Particles } from '@/components/ui/particles';
import { INTEGRATIONS } from '@/lib/integrations';

// The path work takes through the platform. Headline + one line each, no paragraphs.
const FLOW = [
  {
    icon: Database,
    step: 'Data',
    title: 'One source of truth',
    body: 'Connect the systems you already run. No stale exports.',
  },
  {
    icon: PlugsConnected,
    step: 'Gateways',
    title: 'Gateways you control',
    body: 'One or many. Each pipeline binds the one it needs, observed and cost-tracked.',
  },
  {
    icon: GitBranch,
    step: 'Pipelines',
    title: 'Governance in the pipe',
    body: 'Guardrails, redaction, evals, and provenance built in. Solve it once.',
  },
  {
    icon: Robot,
    step: 'Apps & agents',
    title: 'Put to work',
    body: 'Run it as an app a person approves, or an agent that runs on its own.',
  },
];

// Show the product working. Real screenshots + one tight caption each.
const GALLERY = [
  {
    src: '/docs-shots/studio.png',
    alt: 'The Studio: apps and agents a business team builds in plain language',
    eyebrow: 'Build',
    title: 'Anyone builds. In plain language.',
    body: 'A person on finance, claims, or lending describes the work. No engineer, no code.',
  },
  {
    src: '/docs-shots/app-review.png',
    alt: 'The review inbox: a run paused for a human to approve, reject, or edit',
    eyebrow: 'Oversee',
    title: 'A human decides where it matters.',
    body: 'A run pauses for approval, then resumes and finishes on its own.',
  },
  {
    src: '/docs-shots/gateways-list.png',
    alt: 'The gateway list: several model-serving gateways, on-prem and cloud, each with its own health and egress',
    eyebrow: 'Route',
    title: 'Many gateways, one console.',
    body: 'Local fleet or a cloud provider. Every call observed, cost-tracked, on an egress leash you set.',
  },
  {
    src: '/docs-shots/observability.png',
    alt: 'Observability: live eval scores, drift detection, and per-run traces',
    eyebrow: 'Watch',
    title: 'You see when one regresses.',
    body: 'Offline evals, live scoring on real traffic, and drift caught the moment it starts.',
  },
];

// The capability layers, not the engine names.
const CAPABILITY_LAYERS = INTEGRATIONS.map((l) => l.layer);

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

      {/* Hero - a short thesis over the flow diagram, the visual it stands on */}
      <section
        className="relative overflow-hidden border-b border-border"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% -10%, rgba(5,150,105,0.10), transparent 55%)',
        }}
      >
        <Particles className="absolute inset-0" quantity={70} ease={70} color="#059669" />
        <div className="relative z-10 mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
            <div className="max-w-xl">
              <BlurFade delay={0.05} inView>
                <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm">
                  <AnimatedShinyText>AWS for AI · open source</AnimatedShinyText>
                </div>
              </BlurFade>
              <BlurFade delay={0.15} inView>
                <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  Make your enterprise intelligent, on one interface that just works.
                </h1>
              </BlurFade>
              <BlurFade delay={0.3} inView>
                <p className="mt-5 text-base text-muted-foreground">
                  Set your rules once. Anyone builds governed apps and agents in plain language.
                </p>
              </BlurFade>
              <BlurFade delay={0.45} inView>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Button asChild size="lg">
                    <Link href="/overview">
                      Open console
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <a href="/docs" target="_blank" rel="noopener noreferrer">
                      Read the docs
                    </a>
                  </Button>
                </div>
              </BlurFade>
              <BlurFade delay={0.55} inView>
                <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Gauge className="size-3.5 text-primary" /> Works out of the box
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-primary" /> Every call governed
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Code className="size-3.5 text-primary" /> Open source
                  </span>
                </div>
              </BlurFade>
            </div>
            <BlurFade delay={0.25} inView>
              <div className="relative overflow-hidden rounded-xl border border-border bg-[#111] p-2 shadow-sm">
                <Image
                  src="/diagrams/flow/flow-people.png"
                  alt="Your data into governed gateways, through composable pipelines, out to apps and agents your people build in plain language, on infrastructure you own"
                  width={1280}
                  height={720}
                  className="h-auto w-full rounded-lg"
                  priority
                />
                <BorderBeam duration={12} size={280} colorFrom="#34d399" colorTo="#059669" />
              </div>
            </BlurFade>
          </div>
        </div>
      </section>

      {/* The flow - four tight steps, one line each */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              Data → Gateways → Pipelines → Apps &amp; Agents
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              One governed path, end to end
            </h2>
          </BlurFade>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map((s, i) => (
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

      {/* See it work - real screenshots, alternating image + short caption */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">See it work</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              The product, running
            </h2>
          </BlurFade>
          <div className="mt-10 flex flex-col gap-14">
            {GALLERY.map((g, i) => (
              <BlurFade key={g.src} delay={0.04 * i} inView>
                <div className="grid items-center gap-6 lg:grid-cols-[1fr_1.6fr]">
                  <div className={i % 2 === 1 ? 'lg:order-last' : ''}>
                    <p className="font-mono text-xs uppercase tracking-widest text-primary">
                      {g.eyebrow}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                      {g.title}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">{g.body}</p>
                  </div>
                  <figure className="relative overflow-hidden rounded-xl border border-border bg-background shadow-sm">
                    <Image
                      src={g.src}
                      alt={g.alt}
                      width={1600}
                      height={1000}
                      className="h-auto w-full"
                    />
                  </figure>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* Governed by construction - compliance diagram + tight points */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <BlurFade inView>
              <p className="font-mono text-xs uppercase tracking-widest text-primary">Governed</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Compliance travels with every run
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Not a stage you bolt on at the end. Every run is signed, cited, and scored. One that
                fails a check is stopped. Hand a regulator a complete, reversible account.
              </p>
              <ul className="mt-6 grid gap-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <ShieldCheck className="size-4 shrink-0 text-primary" /> Guardrails and PII masking
                  on every call
                </li>
                <li className="flex items-center gap-2">
                  <Gauge className="size-4 shrink-0 text-primary" /> Live scoring and drift on real
                  traffic
                </li>
                <li className="flex items-center gap-2">
                  <GitBranch className="size-4 shrink-0 text-primary" /> Signed provenance,
                  audit-ready exports
                </li>
              </ul>
            </BlurFade>
            <BlurFade delay={0.15} inView>
              <div className="relative overflow-hidden rounded-xl border border-border bg-[#111] p-2 shadow-sm">
                <Image
                  src="/diagrams/flow/flow-compliance.png"
                  alt="Every finished run becomes a signed, cited, scored record; a run that fails a check is stopped; audit-ready evidence exports for a regulator"
                  width={1280}
                  height={720}
                  className="h-auto w-full rounded-lg"
                />
              </div>
            </BlurFade>
          </div>
        </div>
      </section>

      {/* Under the hood + open foundations - one compact band */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              Under the hood
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Open foundations, no lock-in
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Every capability ships with a first-party default and swaps to a best-in-class open
              engine with one environment variable. Runs on your servers or in your cloud.
            </p>
          </BlurFade>
          <BlurFade inView>
            <div className="relative mt-8 overflow-hidden rounded-xl border border-border bg-[#ffffff] p-3 shadow-sm">
              <Image
                src="/diagrams/01-full-architecture.jpg"
                alt="Full governed AI architecture: data plane, model plane, control plane, consumption, and the org and regulatory wrapper"
                width={1376}
                height={768}
                className="h-auto w-full rounded-lg"
              />
              <BorderBeam duration={10} size={340} colorFrom="#34d399" colorTo="#059669" />
            </div>
          </BlurFade>
          <div className="relative mt-8 overflow-hidden">
            <Marquee pauseOnHover className="[--duration:45s] [--gap:0.6rem]">
              {CAPABILITY_LAYERS.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
                >
                  {t}
                </span>
              ))}
            </Marquee>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-card to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-card to-transparent" />
          </div>
        </div>
      </section>

      {/* Close */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <BlurFade inView>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Become an intelligent enterprise, without compromising.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              Open the console and see it running, or read the docs and run it yourself.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/overview">
                  Open console
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a
                  href="https://github.com/off-grid-ai/console"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
              </Button>
            </div>
          </BlurFade>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-xs text-muted-foreground">
          <span>Off Grid AI · AWS for AI · open source</span>
          <span>AGPL-3.0 · set once, use everywhere</span>
        </div>
      </footer>
    </div>
  );
}

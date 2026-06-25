import {
  ArrowRight,
  BookOpen,
  Stack as Boxes,
  Brain,
  ChartLineUp,
  Code,
  Cube,
  Gauge,
  Lock,
  ShareNetwork as Network,
  Scroll as ScrollText,
  SealCheck,
  ShieldCheck,
  TrendUp as TrendingUp,
} from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import { Badge } from '@/components/ui/badge';
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

const PILLARS = [
  {
    icon: Lock,
    title: 'On-prem & local-first',
    body: 'Runs on the org’s own infrastructure. Models run on-device; data never leaves your control.',
  },
  {
    icon: ShieldCheck,
    title: 'Auditable by design',
    body: 'Every model call, tool call, and byte of egress is logged — a record a regulator can defend.',
  },
  {
    icon: Boxes,
    title: 'Modular',
    body: 'Take the whole control plane or just one part. Every capability is API-first and adoptable on its own.',
  },
  {
    icon: ScrollText,
    title: 'Frontline-ready',
    body: 'Built for distributed workforces — govern thousands of edge devices from one console.',
  },
];

const PACKAGES = [
  { name: 'Just the API', body: 'Gateway / Brain / Agents as headless services.' },
  { name: 'API + Console', body: 'This UI over any subset of services.' },
  { name: 'Just the Brain', body: 'The ingestion→retrieval (RAG) pipeline, standalone.' },
  { name: 'The whole control plane', body: 'Every plane, unified and governed.' },
];

const PHASES = [
  {
    n: 'A',
    name: 'Data Plane',
    img: '03-phase-a-data-plane',
    desc: 'Connect source systems, ingest, mask PII, govern, and land it — AI-ready data.',
    maps: ['Data'],
  },
  {
    n: 'B',
    name: 'AI Plane',
    img: '04-phase-b-ai-plane',
    desc: 'Model serving, knowledge bases, tools, and memory — the AI-ready substrate.',
    maps: ['Off Grid AI Gateway', 'Brain', 'Agents'],
  },
  {
    n: 'C',
    name: 'Control Plane',
    img: '05-phase-c-control-plane',
    desc: 'The gateway every call passes through: policy, guardrails, audit, egress, kill switch.',
    maps: ['Gateway', 'Control', 'Fleet', 'Analytics'],
  },
  {
    n: 'E',
    name: 'Org & Regulatory',
    img: '07-phase-e-org-regulatory',
    desc: 'Framework mapping, DPIA, and governance — the regulatory wrapper around it all.',
    maps: ['Regulatory'],
  },
  {
    n: 'D',
    name: 'Consumption',
    img: '06-phase-d-consumption',
    desc: 'Where humans meet the agents — copilots, surfaces, and the feedback loop.',
    maps: ['Console', 'Agents', 'Reports'],
  },
];

const VALUE = [
  {
    icon: Network,
    title: 'Fleet Control',
    body: 'MDM for AI, on open source (FleetDM + osquery). Provision, govern, and observe every AI-enabled device from one console — push policy down, pull audit up, kill-switch on demand. Your workforce runs AI; you keep control.',
  },
  {
    icon: TrendingUp,
    title: 'Frontline & sales productivity',
    body: 'A private, on-device copilot on every rep’s machine — grounded in your own playbooks and winning patterns, so the whole field force sells with your best people’s know-how.',
  },
  {
    icon: Brain,
    title: 'Organizational brain',
    body: 'Off Grid observes how work actually happens and connects your systems, distilling it into one governed knowledge brain that every agent and person draws from — your context, on your infrastructure.',
  },
  {
    icon: Gauge,
    title: 'Agent QA',
    body: 'Know the agents still work. Offline evals, online LLM-as-judge scoring on live traffic, and drift + degradation detection — one surface that answers “are the agents still doing a good job, and if not, which one regressed and when?”',
  },
  {
    icon: SealCheck,
    title: 'Provenance & tamper-evidence',
    body: 'Every report export carries a signed, offline-verifiable manifest (ed25519); images get C2PA Content Credentials; artifacts can be Sigstore-attested. Prove what was produced, by whom, unaltered — with only a public key.',
  },
  {
    icon: Cube,
    title: 'Safe code execution',
    body: 'When an agent needs to run code, it runs in an ephemeral, network-isolated, resource-capped sandbox — off by default, gated by policy. Free and self-hosted; no third-party execution service.',
  },
];

const ALL_TOOLS = INTEGRATIONS.flatMap((l) => l.tools);

function Nav() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <Image src="/logo.png" alt="Off Grid" width={26} height={26} priority />
          <span className="whitespace-nowrap text-sm font-medium text-foreground">
            Off Grid Console
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/features">
              <Boxes className="size-4" />
              <span className="hidden sm:inline">Features</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/journey">
              <ChartLineUp className="size-4" />
              <span className="hidden sm:inline">Journey</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/handbook">
              <BookOpen className="size-4" />
              <span className="hidden sm:inline">Handbook</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href="/docs" target="_blank" rel="noopener noreferrer">
              <Code className="size-4" />
              <span className="hidden sm:inline">API docs</span>
            </a>
          </Button>
          <Button asChild size="sm">
            <Link href="/fleet">Open console</Link>
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
              <AnimatedShinyText>On-prem · local-first · auditable</AnimatedShinyText>
            </div>
          </BlurFade>
          <BlurFade delay={0.15} inView>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              The common control plane for organizational AI
            </h1>
          </BlurFade>
          <BlurFade delay={0.3} inView>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
              One governed chokepoint for every model call, agent action, and byte of data — running
              on your own infrastructure, fully auditable, built on open source. Manage a fleet of
              on-device nodes, ground them in your knowledge, and prove compliance to a regulator.
            </p>
          </BlurFade>
          <BlurFade delay={0.45} inView>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/fleet">
                  Open console
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="/docs" target="_blank" rel="noopener noreferrer">
                  API docs &amp; playground
                </a>
              </Button>
            </div>
          </BlurFade>
        </div>
      </section>

      {/* Value */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-xl font-semibold tracking-tight">
            Built for the workforce, governed by you
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            From the field force to the DPO — democratize your organization’s intelligence to every
            person and device, on one private control plane.
          </p>
          <div className="mt-8 flex snap-x gap-4 overflow-x-auto pb-3 [&>*]:w-[80vw] [&>*]:max-w-xs [&>*]:shrink-0 [&>*]:snap-start md:grid md:grid-cols-2 md:overflow-visible md:pb-0 md:[&>*]:w-auto md:[&>*]:max-w-none lg:grid-cols-3">
            {VALUE.map((v, i) => (
              <BlurFade key={v.title} delay={0.06 * i} inView>
                <MagicCard
                  gradientFrom="#34d399"
                  gradientTo="#059669"
                  gradientColor="rgba(52,211,153,0.12)"
                  gradientOpacity={0.5}
                  className="h-full rounded-xl border border-border p-6 shadow-sm"
                >
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <v.icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground">{v.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{v.body}</p>
                </MagicCard>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-xl font-semibold tracking-tight">Nine planes, one console</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each is independently adoptable — enable only what you bought.
        </p>
        <div className="mt-8 flex snap-x gap-4 overflow-x-auto pb-3 [&>*]:w-[80vw] [&>*]:max-w-xs [&>*]:shrink-0 [&>*]:snap-start md:grid md:grid-cols-2 md:overflow-visible md:pb-0 md:[&>*]:w-auto md:[&>*]:max-w-none lg:grid-cols-3">
          {MODULES.filter((m) => !m.internal).map((m, i) => {
            const Icon = MODULE_ICONS[m.id];
            return (
              <BlurFade key={m.id} delay={0.04 * i} inView>
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

      {/* Five agentic layers */}
      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-xl font-semibold tracking-tight">The five agentic layers</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The reference architecture for a production AI estate — and exactly how Off Grid maps
            onto it.
          </p>
          <Link
            href="/journey"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            See the six-stage journey, from Shadow AI to a self-serve platform
            <ArrowRight className="size-4" />
          </Link>
          <BlurFade inView>
            <div className="relative mt-8 overflow-hidden rounded-xl border border-border bg-[#ffffff] p-3 shadow-sm">
              <Image
                src="/diagrams/01-full-architecture.jpg"
                alt="Full agentic AI architecture"
                width={1376}
                height={768}
                className="h-auto w-full rounded-lg"
                priority
              />
              <BorderBeam duration={10} size={340} colorFrom="#34d399" colorTo="#059669" />
            </div>
          </BlurFade>
          <div className="mt-12 space-y-12">
            {PHASES.map((p, i) => (
              <BlurFade key={p.n} inView>
                <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
                  <div
                    className={`overflow-hidden rounded-xl border border-border bg-[#ffffff] p-3 shadow-sm ${
                      i % 2 === 1 ? 'lg:order-last' : ''
                    }`}
                  >
                    <Image
                      src={`/diagrams/${p.img}.jpg`}
                      alt={`${p.name} diagram`}
                      width={1376}
                      height={768}
                      className="h-auto w-full rounded-lg"
                    />
                  </div>
                  <div>
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      Phase {p.n}
                    </Badge>
                    <h3 className="mt-3 text-lg font-semibold tracking-tight">{p.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        In Off Grid
                      </span>
                      {p.maps.map((m) => (
                        <Badge key={m} variant="secondary">
                          {m}
                        </Badge>
                      ))}
                    </div>
                    <Link
                      href={`/architecture/${p.n.toLowerCase()}`}
                      className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Explore the {p.name} layer
                      <ArrowRight className="size-4" />
                    </Link>
                  </div>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* Open source */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-xl font-semibold tracking-tight">Built on open source</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The console makes the best-in-class OSS tools work together — no lock-in.
          </p>
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
          <div className="mt-10 flex snap-x gap-4 overflow-x-auto pb-3 [&>*]:w-[80vw] [&>*]:max-w-xs [&>*]:shrink-0 [&>*]:snap-start md:grid md:grid-cols-2 md:overflow-visible md:pb-0 md:[&>*]:w-auto md:[&>*]:max-w-none lg:grid-cols-3">
            {INTEGRATIONS.map((l) => (
              <Card key={l.layer} className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{l.layer}</CardTitle>
                  <p className="text-xs text-muted-foreground">{l.blurb}</p>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {l.tools.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex snap-x gap-4 overflow-x-auto pb-3 [&>*]:w-[80vw] [&>*]:max-w-xs [&>*]:shrink-0 [&>*]:snap-start md:grid md:grid-cols-2 md:overflow-visible md:pb-0 md:[&>*]:w-auto md:[&>*]:max-w-none lg:grid-cols-4">
          {PILLARS.map((p) => (
            <Card key={p.title} className="shadow-sm">
              <CardHeader className="pb-2">
                <p.icon className="size-5 text-primary" />
                <CardTitle className="mt-2 text-sm">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{p.body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Packaging */}
      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-xl font-semibold tracking-tight">Buy only what you want</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Take any one of the nine planes on its own, any combination, or the whole control plane.
            Every module is API-first and standalone — start with one, add the rest when you&apos;re
            ready.
          </p>
          <div className="mt-8 flex snap-x gap-3 overflow-x-auto pb-3 [&>*]:w-[72vw] [&>*]:max-w-[16rem] [&>*]:shrink-0 [&>*]:snap-start md:grid md:grid-cols-3 md:overflow-visible md:pb-0 md:[&>*]:w-auto md:[&>*]:max-w-none">
            {MODULES.filter((m) => !m.internal).map((m) => {
              const Icon = MODULE_ICONS[m.id];
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5"
                >
                  <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm text-foreground">{m.label}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      standalone
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Or bundle it:</span>
            {PACKAGES.map((p) => (
              <Badge key={p.name} variant="secondary">
                {p.name}
              </Badge>
            ))}
          </div>
          <div className="mt-10 flex items-center justify-center">
            <Button asChild size="lg">
              <Link href="/fleet">
                Open the console
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-xs text-muted-foreground">
          <span>Off Grid · on-prem, local-first AI control plane</span>
          <span>AGPL-3.0 · your infrastructure, your control</span>
        </div>
      </footer>
    </div>
  );
}

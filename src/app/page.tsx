import { GithubLogo, Path, SealCheck, ShieldCheck, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';
import { CtaButtons } from '@/app/_landing/cta-buttons';
import { FlowDiagram } from '@/app/_landing/flow-diagram';
import { LandingThemeDefault } from '@/app/_landing/landing-theme';
import { ProductTour } from '@/app/_landing/product-tour';
import { SeeItLive } from '@/app/_landing/see-it-live';
import { BookCallDialog } from '@/components/auth/BookCallDialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AuroraText } from '@/components/ui/aurora-text';
import { BlurFade } from '@/components/ui/blur-fade';
import { Button } from '@/components/ui/button';
import { DecryptText } from '@/components/ui/decrypt-text';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Spotlight } from '@/components/ui/spotlight';
import type { TourShot } from '@/lib/landing-hero';

// Six real surfaces from the running console - proof, not promise. The Studio shot leads (the
// plain-language authoring moment), then the governed path in order. Ids drive the ?shot= URL.
const SHOTS: TourShot[] = [
  {
    id: 'studio',
    src: '/docs-shots/studio.png',
    alt: 'The Studio: real BFSI apps and agents a business team stands up in plain language, each governed',
    label: 'Build',
    caption: 'A business team builds a governed app in plain language. No code.',
  },
  {
    id: 'route',
    src: '/docs-shots/gateways-list.png',
    alt: 'The gateway list: several model-serving gateways, on-prem and cloud, each observed',
    label: 'Route',
    caption: 'Many gateways, on your servers or in the cloud. Each one observed.',
  },
  {
    id: 'pipelines',
    src: '/docs-shots/pipeline-overview.png',
    alt: 'A pipeline: model, evals, guardrails, policy, and drift bound to one use case',
    label: 'Govern',
    caption: 'Bind the rules to a use case once. Everything inherits them.',
  },
  {
    id: 'watch',
    src: '/docs-shots/observability.png',
    alt: 'Observability: live eval scores, drift detection, and per-run traces',
    label: 'Watch',
    caption: 'Live scoring on real traffic. Drift caught as it starts.',
  },
  {
    id: 'oversee',
    src: '/docs-shots/app-review.png',
    alt: 'The review inbox: a run paused for a person to approve, reject, or edit',
    label: 'Oversee',
    caption: 'A run pauses for a person, then finishes on its own.',
  },
  {
    id: 'prove',
    src: '/docs-shots/regulatory.png',
    alt: 'Regulatory: controls mapped to ISO 42001, NIST AI RMF, and the EU AI Act',
    label: 'Prove',
    caption: 'Controls mapped to the frameworks a regulator asks for.',
  },
];

// The proof strip: CIO/CISO outcomes, each true and defensible - not engineering vanity.
const PROOF: { value: string; label: string }[] = [
  { value: '1', label: 'interface for every model, gateway and pipeline' },
  { value: '0', label: 'engineering tickets: business teams ship governed AI in plain language' },
  { value: '100%', label: 'of AI traffic logged, traced, reversible. Rules set once, inherited everywhere' },
  { value: '4', label: 'frameworks on demand: ISO 42001, NIST AI RMF, EU AI Act, DPDP' },
];

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[100rem] items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 shrink items-center gap-2 sm:gap-2.5">
          <Image src="/logo.png" alt="Off Grid AI" width={24} height={24} priority />
          <span className="truncate text-sm font-medium text-foreground">Off Grid AI</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
            Console
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/docs">Docs</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a
              href="https://github.com/off-grid-ai/console"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubLogo className="size-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
          <Button
            asChild
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
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
      <LandingThemeDefault />
      <Nav />

      {/* ── Hero: the thesis + the live invitation, above the fold ─────────── */}
      <section className="relative overflow-hidden border-b border-border">
        <Spotlight />
        <div className="relative z-10 mx-auto max-w-[100rem] px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
            <div>
              <BlurFade delay={0.05} inView>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <Sparkle className="size-3.5 text-primary" weight="fill" />
                  AWS for AI · open source
                </span>
              </BlurFade>
              <BlurFade delay={0.12} inView>
                <h1 className="mt-6 text-[2rem] font-semibold leading-[1.06] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                  Win your industry.{' '}
                  <AuroraText className="font-semibold">Put AI to work</AuroraText> across the whole
                  company.
                </h1>
              </BlurFade>
              <BlurFade delay={0.24} inView>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                  One interface where AI is already safe to run. Set your rules once. Everyone builds
                  inside them.
                </p>
              </BlurFade>
              <BlurFade delay={0.32} inView>
                <div className="mt-7 flex max-w-xs">
                  <BookCallDialog label="Book a demo" variant="default" size="lg" className="w-full" autoOpenParam="book" />
                </div>
              </BlurFade>
              <BlurFade delay={0.4} inView>
                <div className="mt-4">
                  <CtaButtons githubLabel="View the source" />
                </div>
              </BlurFade>
              <BlurFade delay={0.48} inView>
                <div className="mt-8">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Explore a live, seeded console
                  </p>
                  <SeeItLive className="mt-3 max-w-xl" />
                </div>
              </BlurFade>
            </div>

            <BlurFade delay={0.2} inView>
              <figure className="relative overflow-hidden rounded-2xl border border-border bg-[#f4f2ec] p-1.5 shadow-[0_30px_120px_-30px_rgba(5,150,105,0.25)]">
                <Image
                  src="/diagrams/hero-awsforai.png"
                  alt="Every piece already exists; wiring it is the problem. Off Grid AI is the one interface, already set up: set your rules once, everyone builds inside them, and put AI to work safely without losing out."
                  width={1376}
                  height={768}
                  priority
                  className="h-auto w-full rounded-xl"
                />
              </figure>
            </BlurFade>
          </div>
        </div>
      </section>

      {/* ── The tour: the core value, the whole product live ───────────────── */}
      <section className="relative border-b border-border bg-card/40">
        <div className="mx-auto max-w-[100rem] px-4 pb-16 pt-6 sm:px-6 sm:pb-20">
          <Suspense fallback={null}>
            <ProductTour shots={SHOTS} />
          </Suspense>
        </div>
      </section>

      {/* ── One governed path: the flow, with the guarantees folded in ─────── */}
      <section className="relative border-b border-border">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <BlurFade inView>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
              <Path className="size-4" weight="bold" />
              One governed path
            </p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              From your data to a{' '}
              <DecryptText text="signed, audited" className="text-primary" /> result. One path, end
              to end.
            </h2>
          </BlurFade>
          <BlurFade delay={0.12} inView>
            <div className="mt-10 rounded-2xl border border-border bg-card p-5 sm:mt-12 sm:p-12">
              <FlowDiagram />
              {/* The five governance guarantees, folded into three compact chips (was a 5-card
                  Bento). Same point, a fraction of the scroll. */}
              <ul className="mt-8 grid gap-3 border-t border-border pt-6 sm:mt-10 sm:grid-cols-3">
                {[
                  {
                    icon: ShieldCheck,
                    title: 'Guarded on every call',
                    body: 'Prompt-injection, PII and policy screened in the pipe. A blocked call never leaves.',
                  },
                  {
                    icon: Path,
                    title: 'Scored and traced, live',
                    body: 'Every run scored against a golden set, watched for drift, traced to its source.',
                  },
                  {
                    icon: SealCheck,
                    title: 'Signed and set once',
                    body: 'Every answer cited and signed. An admin sets the rules once; nobody re-implements them.',
                  },
                ].map((chip) => (
                  <li
                    key={chip.title}
                    className="flex gap-3 rounded-xl border border-border bg-background/40 p-4"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-primary/10 text-primary">
                      <chip.icon className="size-4" weight="bold" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-foreground">
                        {chip.title}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {chip.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </BlurFade>
        </div>
      </section>

      {/* ── Proof strip: CIO/CISO outcomes ─────────────────────────────────── */}
      <section className="relative border-b border-border bg-card/40">
        <div className="mx-auto grid max-w-[100rem] grid-cols-2 gap-x-4 gap-y-10 px-4 py-14 sm:px-6 lg:grid-cols-4">
          {PROOF.map((stat, i) => (
            <BlurFade key={stat.label} delay={0.08 * i} inView>
              <div className="px-1 text-center sm:px-2">
                <div className="font-mono text-4xl font-semibold tracking-tight text-primary sm:text-5xl">
                  <NumberTicker value={stat.value} />
                </div>
                <p className="mx-auto mt-3 max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </BlurFade>
          ))}
        </div>
      </section>

      {/* ── Close: what "without losing out" actually means ────────────────── */}
      <section className="relative border-b border-border">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
            <BlurFade inView>
              <figure className="relative overflow-hidden rounded-2xl border border-border bg-[#f4f2ec] p-1.5 shadow-[0_30px_120px_-30px_rgba(5,150,105,0.22)]">
                <Image
                  src="/diagrams/flow/flow-compliance.png"
                  alt="Compliance travels with every run: each run is signed, cited and scored; one that fails a check is stopped; audit-ready evidence exports for a regulator. Cloud or on-prem, the control stays with you."
                  width={1280}
                  height={720}
                  className="h-auto w-full rounded-xl"
                />
              </figure>
            </BlurFade>
            <div>
              <BlurFade inView>
                <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
                  <SealCheck className="size-4" weight="bold" />
                  Without losing out
                </p>
                <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
                  Become an intelligent enterprise, without compromising.
                </h2>
                <ul className="mt-6 grid gap-4">
                  {[
                    {
                      title: 'Complete control',
                      body: 'Your data, your models, your rules. Cloud or on-prem, the control stays with you.',
                    },
                    {
                      title: 'No vendor lock-in',
                      body: 'Open source, open standards. Swap a model or a gateway without ripping anything out.',
                    },
                    {
                      title: 'One coherent system',
                      body: 'Every part speaks to every other part. One platform, not twenty duct-taped tools.',
                    },
                  ].map((item) => (
                    <li key={item.title} className="border-l-2 border-primary/50 pl-4">
                      <span className="block text-sm font-semibold text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                        {item.body}
                      </span>
                    </li>
                  ))}
                </ul>
              </BlurFade>
              <BlurFade delay={0.15} inView>
                <div className="mt-8">
                  <CtaButtons />
                </div>
              </BlurFade>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-background">
        <div className="mx-auto flex max-w-[100rem] flex-col items-center justify-between gap-2 px-4 py-8 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground sm:flex-row sm:px-6">
          <span>Off Grid AI · AWS for AI · open source</span>
          <span>AGPL-3.0 · set once, use everywhere</span>
        </div>
      </footer>
    </div>
  );
}

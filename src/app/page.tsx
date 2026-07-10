import {
  Broadcast,
  GithubLogo,
  Path,
  ScribbleLoop,
  SealCheck,
  ShieldCheck,
  Sparkle,
} from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { CtaButtons } from '@/app/_landing/cta-buttons';
import { FlowDiagram } from '@/app/_landing/flow-diagram';
import { AuroraText } from '@/components/ui/aurora-text';
import { BentoGrid, BentoTile } from '@/components/ui/bento-grid';
import { BlurFade } from '@/components/ui/blur-fade';
import { Button } from '@/components/ui/button';
import { type CarouselCard, CardsCarousel } from '@/components/ui/cards-carousel';
import { ContainerScroll } from '@/components/ui/container-scroll';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Spotlight } from '@/components/ui/spotlight';

// Six real surfaces from the running console — proof, not promise.
const SURFACES: CarouselCard[] = [
  {
    src: '/docs-shots/app-review.png',
    alt: 'The review inbox: a run paused for a person to approve, reject, or edit',
    label: 'Oversee',
    caption: 'A run pauses for a person, then finishes on its own.',
  },
  {
    src: '/docs-shots/pipeline-overview.png',
    alt: 'A pipeline: model, evals, guardrails, policy, and drift bound to one use case',
    label: 'Pipelines',
    caption: 'Bind the rules to a use case once. Everything inherits them.',
  },
  {
    src: '/docs-shots/observability.png',
    alt: 'Observability: live eval scores, drift detection, and per-run traces',
    label: 'Watch',
    caption: 'Live scoring on real traffic. Drift caught as it starts.',
  },
  {
    src: '/docs-shots/gateways-list.png',
    alt: 'The gateway list: several model-serving gateways, on-prem and cloud, each observed',
    label: 'Route',
    caption: 'Many gateways, on your servers or cloud. Each one observed.',
  },
  {
    src: '/docs-shots/lineage.png',
    alt: 'Lineage: the graph of where every answer came from',
    label: 'Trace',
    caption: 'Every answer traced to where it came from.',
  },
  {
    src: '/docs-shots/regulatory.png',
    alt: 'Regulatory: controls mapped to ISO 42001, NIST AI RMF, and the EU AI Act',
    label: 'Prove',
    caption: 'Controls mapped to the frameworks a regulator asks for.',
  },
];

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[100rem] items-center justify-between px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <Image src="/logo.png" alt="Off Grid AI" width={24} height={24} priority />
          <span className="text-sm font-medium text-white">Off Grid AI</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 sm:inline">
            Console
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-white/70 hover:bg-white/5 hover:text-white"
          >
            <a
              href="https://github.com/off-grid-ai/console"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubLogo className="size-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
          <Button asChild size="sm" className="bg-[#34D399] text-black hover:bg-[#6EE7B7]">
            <Link href="/overview">Open console</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export default function LandingPage() {
  return (
    <div
      data-theme="dark"
      className="dark min-h-screen bg-[#0a0a0a] text-white"
    >
      <Nav />

      {/* ── Hero: the thesis, over the sketch that IS the pitch ────────────── */}
      <section className="relative overflow-hidden border-b border-white/10">
        <Spotlight />
        <div className="relative z-10 mx-auto max-w-[100rem] px-6 py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr]">
            <div>
              <BlurFade delay={0.05} inView>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-white/60">
                  <Sparkle className="size-3.5 text-[#34D399]" weight="fill" />
                  AWS for AI · open source
                </span>
              </BlurFade>
              <BlurFade delay={0.12} inView>
                <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Win your industry.{' '}
                  <AuroraText className="font-semibold">Put AI to work</AuroraText> across the whole
                  company.
                </h1>
              </BlurFade>
              <BlurFade delay={0.24} inView>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
                  One interface, on your infrastructure, where AI is already safe to run. Set your
                  rules once. Everyone builds inside them. Nothing to rip out.
                </p>
              </BlurFade>
              <BlurFade delay={0.36} inView>
                <div className="mt-9">
                  <CtaButtons githubLabel="View the source" />
                </div>
              </BlurFade>
            </div>

            <BlurFade delay={0.2} inView>
              <figure className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#f4f2ec] p-1.5 shadow-[0_30px_120px_-30px_rgba(52,211,153,0.4)]">
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

      {/* ── The flow: five real stages, wired live ────────────────────────── */}
      <section className="relative border-b border-white/10">
        <div className="mx-auto max-w-[100rem] px-6 py-20">
          <BlurFade inView>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[#34D399]">
              <Path className="size-4" weight="bold" />
              One governed path
            </p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              From your data to a signed, audited result. One path, end to end.
            </h2>
          </BlurFade>
          <BlurFade delay={0.15} inView>
            <div className="mt-14 rounded-2xl border border-white/10 bg-[#0c0c0c] p-6 sm:p-12">
              <FlowDiagram />
            </div>
          </BlurFade>
        </div>
      </section>

      {/* ── See it: the product rising into view, then a rail of surfaces ─── */}
      <section className="relative border-b border-white/10 bg-[#0c0c0c]">
        <div className="mx-auto max-w-[100rem] px-6 pb-20 pt-8">
          <ContainerScroll
            header={
              <div className="text-center">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#34D399]">
                  See it running
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Anyone builds. In plain language. Governed by default.
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-sm text-white/55">
                  A person on lending, claims, or finance describes the work. No engineer, no code.
                </p>
              </div>
            }
          >
            <Image
              src="/docs-shots/studio.png"
              alt="The Studio: real BFSI apps and agents a business team stands up in plain language, each governed"
              width={1600}
              height={1000}
              className="h-auto w-full"
            />
          </ContainerScroll>

          <BlurFade inView>
            <div className="mt-8">
              <CardsCarousel cards={SURFACES} />
            </div>
          </BlurFade>
        </div>
      </section>

      {/* ── Safe / set-once: the unlock, as compact tiles ─────────────────── */}
      <section className="relative border-b border-white/10">
        <div className="mx-auto max-w-[100rem] px-6 py-20">
          <BlurFade inView>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[#34D399]">
              <ShieldCheck className="size-4" weight="bold" />
              Set once, use everywhere
            </p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Safe is the unlock. It is what lets you move fast without fear.
            </h2>
          </BlurFade>
          <BlurFade delay={0.12} inView>
            <BentoGrid className="mt-10">
              <BentoTile
                className="lg:col-span-3"
                icon={ShieldCheck}
                title="Guardrails on every call"
                body="Prompt-injection, PII, toxicity, and policy screened in the pipe. A call that is not allowed off the box does not leave."
              />
              <BentoTile
                className="lg:col-span-3"
                icon={ScribbleLoop}
                title="Evals and drift, live"
                body="Every run scored against a golden set and watched for drift, so you see the moment one regresses."
              />
              <BentoTile
                className="lg:col-span-2"
                icon={SealCheck}
                title="Signed provenance"
                body="Every answer cited and signed to an append-only log."
              />
              <BentoTile
                className="lg:col-span-2"
                icon={Path}
                title="Audit and lineage"
                body="Trace any result to its source. Export it for a regulator."
              />
              <BentoTile
                className="lg:col-span-2"
                icon={Broadcast}
                title="One rule set, inherited"
                body="An admin sets the rules once. Nobody re-implements them."
              />
            </BentoGrid>
          </BlurFade>
        </div>
      </section>

      {/* ── Proof strip: real numbers only ────────────────────────────────── */}
      <section className="relative border-b border-white/10 bg-[#0c0c0c]">
        <div className="mx-auto grid max-w-[100rem] grid-cols-2 gap-y-10 px-6 py-16 lg:grid-cols-4">
          {[
            { value: 1, suffix: '', label: 'Docker bring-up wires the whole stack' },
            { value: 85, suffix: '%+', label: 'Test coverage, enforced on every push' },
            { value: 3, suffix: '', label: 'Frameworks mapped: ISO 42001, NIST, EU AI Act' },
            { value: 0, suffix: '', label: 'Vendors your data is handed to' },
          ].map((stat, i) => (
            <BlurFade key={stat.label} delay={0.08 * i} inView>
              <div className="px-2 text-center">
                <div className="font-mono text-4xl font-semibold tracking-tight text-[#34D399] sm:text-5xl">
                  <NumberTicker value={stat.value} suffix={stat.suffix} />
                </div>
                <p className="mx-auto mt-3 max-w-[16rem] text-xs leading-relaxed text-white/50">
                  {stat.label}
                </p>
              </div>
            </BlurFade>
          ))}
        </div>
      </section>

      {/* ── Close: compliance travels with every run ──────────────────────── */}
      <section className="relative border-b border-white/10">
        <div className="mx-auto max-w-[100rem] px-6 py-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <BlurFade inView>
              <figure className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#f4f2ec] p-1.5 shadow-[0_30px_120px_-30px_rgba(52,211,153,0.35)]">
                <Image
                  src="/diagrams/flow/flow-compliance.png"
                  alt="Compliance is not a step you bolt on; it travels with every run. Each run is signed, cited, and scored; one that fails a check is stopped; audit-ready evidence exports for a regulator, on infrastructure you own."
                  width={1280}
                  height={720}
                  className="h-auto w-full rounded-xl"
                />
              </figure>
            </BlurFade>
            <div>
              <BlurFade inView>
                <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[#34D399]">
                  <SealCheck className="size-4" weight="bold" />
                  Without losing out
                </p>
                <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
                  Become an intelligent enterprise, without compromising.
                </h2>
                <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60">
                  No rip and replace. No lock-in. No handing your moat to anyone. Open the console
                  and see it running, or read the source and run it yourself.
                </p>
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

      <footer className="bg-[#0a0a0a]">
        <div className="mx-auto flex max-w-[100rem] flex-col items-center justify-between gap-2 px-6 py-8 font-mono text-[11px] uppercase tracking-[0.15em] text-white/40 sm:flex-row">
          <span>Off Grid AI · AWS for AI · open source</span>
          <span>AGPL-3.0 · set once, use everywhere</span>
        </div>
      </footer>
    </div>
  );
}

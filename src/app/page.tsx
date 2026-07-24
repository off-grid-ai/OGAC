import {
  ArrowRight,
  Brain,
  Cpu,
  GithubLogo,
  Path,
  SealCheck,
  ShieldCheck,
  Sparkle,
  Stack,
} from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';
import { CtaButtons } from '@/app/_landing/cta-buttons';
import { LandingThemeDefault } from '@/app/_landing/landing-theme';
import { ProductTour } from '@/app/_landing/product-tour';
import { SeeItLive } from '@/app/_landing/see-it-live';
import { BookCallDialog } from '@/components/auth/BookCallDialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AuroraText } from '@/components/ui/aurora-text';
import { BentoGrid, BentoTile } from '@/components/ui/bento-grid';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { DotPattern } from '@/components/ui/dot-pattern';
import { MagicCard } from '@/components/ui/magic-card';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Spotlight } from '@/components/ui/spotlight';
import { LANDING } from '@/lib/landing-copy';
import type { TourShot } from '@/lib/landing-hero';

// Six real surfaces from the running product — proof, not promise. The Studio shot leads (the
// plain-language authoring moment), then the governed path in order. Ids drive the ?shot= URL.
const SHOTS: TourShot[] = [
  { id: 'studio', src: '/docs-shots/studio.png', alt: 'A business team stands up a governed app in plain language', label: 'Act', caption: 'A business team builds a governed app in plain language. No code.' },
  { id: 'route', src: '/docs-shots/gateways-list.png', alt: 'Model-serving gateways, on-prem and cloud, each observed', label: 'Route', caption: 'Many models, on your servers or in the cloud. Each one observed.' },
  { id: 'pipelines', src: '/docs-shots/pipeline-overview.png', alt: 'A pipeline: model, evals, guardrails, policy, and drift bound to one use case', label: 'Govern', caption: 'Bind the rules to a use case once. Everything inherits them.' },
  { id: 'watch', src: '/docs-shots/observability.png', alt: 'Observability: live eval scores, drift detection, and per-run traces', label: 'Watch', caption: 'Live scoring on real traffic. Drift caught as it starts.' },
  { id: 'oversee', src: '/docs-shots/app-review.png', alt: 'The review inbox: a run paused for a person to approve, reject, or edit', label: 'Review', caption: 'A run pauses for a person, then finishes on its own.' },
  { id: 'prove', src: '/docs-shots/regulatory.png', alt: 'Regulatory: controls mapped to ISO 42001, NIST AI RMF, and the EU AI Act', label: 'Prove', caption: 'Controls mapped to the frameworks a regulator asks for.' },
];

const PILLAR_ICONS = [Cpu, Brain, Stack, ShieldCheck] as const;

// Resolve a copy link key to a real href. "View the live product" leads into the running console.
function href(key: 'liveProduct' | 'source' | 'docs' | 'email'): string {
  if (key === 'liveProduct') return '/overview';
  return LANDING.links[key];
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[100rem] items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 shrink items-center gap-2 sm:gap-2.5">
          <Image src="/logo.png" alt="Off Grid AI" width={24} height={24} priority />
          <span className="truncate text-sm font-medium text-foreground">Off Grid AI</span>
        </div>
        <nav className="hidden items-center gap-1 md:flex">
          {LANDING.nav.map((n) => (
            <Button key={n.href} asChild variant="ghost" size="sm">
              <a href={n.href}>{n.label}</a>
            </Button>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href={LANDING.links.source} target="_blank" rel="noopener noreferrer">
              <GithubLogo className="size-4" />
              <span className="hidden sm:inline">Source</span>
            </a>
          </Button>
          <Button asChild size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Link href={href('liveProduct')}>View the live product</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function SectionHead({ number, kicker, heading, intro }: Readonly<{ number: string; kicker: string; heading: string; intro?: string }>) {
  return (
    <BlurFade inView>
      <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
        <span className="text-muted-foreground">{number}</span>
        {kicker}
      </p>
      <h2 className="mt-3 max-w-3xl text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {heading}
      </h2>
      {intro ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{intro}</p> : null}
    </BlurFade>
  );
}

export default function LandingPage() {
  const c = LANDING;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingThemeDefault />
      <Nav />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section id="hero" className="relative overflow-hidden border-b border-border">
        <Spotlight />
        <div className="relative z-10 mx-auto max-w-[100rem] px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
            <div>
              <BlurFade delay={0.05} inView>
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <Sparkle className="size-3.5 text-primary" weight="fill" />
                  {c.hero.eyebrow} · source available
                </span>
              </BlurFade>
              <BlurFade delay={0.12} inView>
                <h1 className="mt-6 text-[1.8rem] font-semibold leading-[1.08] tracking-tight text-foreground sm:text-4xl lg:text-[3.1rem]">
                  Enable every person to operate with the{' '}
                  <AuroraText className="font-semibold">intelligence and capabilities</AuroraText> of the
                  entire enterprise.
                </h1>
              </BlurFade>
              <BlurFade delay={0.24} inView>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                  {c.hero.supporting}
                </p>
              </BlurFade>
              <BlurFade delay={0.3} inView>
                <p className="mt-4 max-w-xl font-mono text-sm leading-relaxed text-foreground">
                  {c.hero.offer}
                </p>
              </BlurFade>
              <BlurFade delay={0.36} inView>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Link href={href('liveProduct')}>
                      {c.hero.cta}
                      <ArrowRight className="size-4" weight="bold" />
                    </Link>
                  </Button>
                  <BookCallDialog label="Book a call" variant="outline" size="lg" autoOpenParam="book" />
                </div>
              </BlurFade>
              <BlurFade delay={0.48} inView>
                <div className="mt-8">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {c.hero.trustLabel}
                  </p>
                  <SeeItLive className="mt-3 max-w-xl" />
                </div>
              </BlurFade>
            </div>

            {/* The four layers: Learn → Remember → Act → Control */}
            <BlurFade delay={0.2} inView>
              <ol className="grid gap-3 sm:grid-cols-2">
                {c.hero.layers.map((layer) => (
                  <li key={layer.number} className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-primary">{layer.number}</span>
                      <span className="text-sm font-semibold text-foreground">{layer.name}</span>
                    </div>
                    <ul className="mt-3 grid gap-1.5">
                      {layer.points.map((p) => (
                        <li key={p} className="text-xs leading-relaxed text-muted-foreground">
                          {p}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </BlurFade>
          </div>
        </div>
      </section>

      {/* ── Product tour (the whole product, live) ─────────────────────────── */}
      <section className="relative border-b border-border bg-card/40">
        <div className="mx-auto max-w-[100rem] px-4 pb-16 pt-6 sm:px-6 sm:pb-20">
          <Suspense fallback={null}>
            <ProductTour shots={SHOTS} />
          </Suspense>
        </div>
      </section>

      {/* ── 01 Overview ────────────────────────────────────────────────────── */}
      <section id="overview" className="relative border-b border-border">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <SectionHead number={c.overview.number} kicker={c.overview.kicker} heading={c.overview.heading} intro={c.overview.body} />
          <BlurFade delay={0.12} inView>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {c.overview.steps.map((s) => (
                <div key={s.number} className="rounded-2xl border border-border bg-card p-5">
                  <span className="font-mono text-xs text-primary">{s.number}</span>
                  <h3 className="mt-2 text-sm font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.description}</p>
                </div>
              ))}
            </div>
          </BlurFade>
          <BlurFade delay={0.2} inView>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {c.overview.pillars.map((p, i) => {
                const Icon = PILLAR_ICONS[i] ?? Cpu;
                return (
                  <div key={p.label} className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
                    <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-background text-primary">
                      <Icon className="size-4" weight="bold" />
                    </span>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {p.label} · {p.name}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-foreground">{p.description}</p>
                  </div>
                );
              })}
            </div>
          </BlurFade>
        </div>
      </section>

      {/* ── 02 Capabilities ────────────────────────────────────────────────── */}
      <section id="capabilities" className="relative border-b border-border bg-card/40">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <SectionHead number={c.capabilities.number} kicker={c.capabilities.kicker} heading={c.capabilities.heading} intro={c.capabilities.intro} />
          <BlurFade delay={0.1} inView>
            <BentoGrid className="mt-10">
              {c.capabilities.items.map((it, i) => (
                <BentoTile
                  key={it.number}
                  icon={PILLAR_ICONS[i] ?? Cpu}
                  title={`${it.number} · ${it.name}`}
                  body={it.summary}
                />
              ))}
            </BentoGrid>
          </BlurFade>
        </div>
      </section>

      {/* ── 03 Numbers ─────────────────────────────────────────────────────── */}
      <section id="numbers" className="relative overflow-hidden border-b border-border">
        <DotPattern
          width={22}
          height={22}
          className="[mask-image:radial-gradient(60rem_circle_at_center,white,transparent)] opacity-60"
        />
        <div className="relative mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <SectionHead number={c.numbers.number} kicker={c.numbers.kicker} heading={c.numbers.heading} intro={c.numbers.intro} />
          <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-7">
            {c.numbers.metrics.map((m, i) => (
              <BlurFade key={m.label} delay={0.06 * i} inView>
                <div className="text-center">
                  <div className="font-mono text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
                    <NumberTicker value={m.value} />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-foreground">{m.label}</p>
                  <p className="mx-auto mt-1 max-w-[12rem] text-[11px] leading-relaxed text-muted-foreground">
                    {m.description}
                  </p>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 Outcomes ────────────────────────────────────────────────────── */}
      <section id="outcomes" className="relative border-b border-border bg-card/40">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <SectionHead number={c.outcomes.number} kicker={c.outcomes.kicker} heading={c.outcomes.heading} intro={c.outcomes.intro} />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {c.outcomes.items.map((it, i) => (
              <BlurFade key={it.number} delay={0.1 * i} inView>
                <div className="flex h-full flex-col rounded-2xl border border-border bg-background p-6">
                  <span className="font-mono text-xs text-muted-foreground">{it.number}</span>
                  <h3 className="mt-2 text-base font-semibold text-foreground">{it.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.description}</p>
                  <p className="mt-4 border-l-2 border-primary/50 pl-3 text-sm font-medium text-foreground">
                    {it.outcome}
                  </p>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* ── 05 Trust ───────────────────────────────────────────────────────── */}
      <section id="trust" className="relative border-b border-border">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <SectionHead number={c.trust.number} kicker={c.trust.kicker} heading={c.trust.heading} intro={c.trust.intro} />
          <BlurFade delay={0.1} inView>
            <div className="mt-6 flex flex-wrap gap-2">
              {c.trust.attributes.map((a) => (
                <span key={a} className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-primary">
                  {a}
                </span>
              ))}
            </div>
          </BlurFade>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.trust.items.map((it, i) => (
              <BlurFade key={it.name} delay={0.06 * i} inView>
                <div className="flex gap-3 rounded-2xl border border-border bg-card p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-primary/10 text-primary">
                    <SealCheck className="size-4" weight="bold" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{it.name}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{it.outcome}</span>
                  </span>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* ── 06 Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="relative border-b border-border bg-card/40">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <SectionHead number={c.pricing.number} kicker={c.pricing.kicker} heading={c.pricing.heading} intro={c.pricing.intro} />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {c.pricing.plans.map((plan, i) => (
              <BlurFade key={plan.name} delay={0.08 * i} inView>
                <MagicCard
                  className={`relative flex h-full flex-col overflow-hidden rounded-2xl border bg-background p-6 ${i === 2 ? 'border-primary/50 shadow-[0_20px_80px_-30px_rgba(5,150,105,0.25)]' : 'border-border'}`}
                >
                  {i === 2 ? (
                    <BorderBeam size={90} duration={7} colorFrom="#34d399" colorTo="#059669" />
                  ) : null}
                  <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                  <p className="mt-2 flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-semibold tracking-tight text-foreground">{plan.price}</span>
                    <span className="text-xs text-muted-foreground">{plan.suffix}</span>
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
                  <ul className="mt-5 grid flex-1 gap-2">
                    {plan.features.map((f) => (
                      <li key={f} className="flex gap-2 text-sm text-foreground">
                        <SealCheck className="mt-0.5 size-4 shrink-0 text-primary" weight="fill" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant={i === 2 ? 'default' : 'outline'} size="sm" className="mt-6">
                    <Link href={href(plan.cta.href)}>{plan.cta.label}</Link>
                  </Button>
                </MagicCard>
              </BlurFade>
            ))}
          </div>
          {/* Comparison */}
          <BlurFade delay={0.2} inView>
            <div className="mt-10 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-card">
                    <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Comparison</th>
                    {c.pricing.comparison.planNames.map((n) => (
                      <th key={n} className="px-4 py-3 text-left font-semibold text-foreground">{n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.pricing.comparison.rows.map((row) => (
                    <tr key={row.capability} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-muted-foreground">{row.capability}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="px-4 py-3 text-foreground">{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </BlurFade>
        </div>
      </section>

      {/* ── 07 Proof ───────────────────────────────────────────────────────── */}
      <section id="proof" className="relative border-b border-border">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <SectionHead number={c.proof.number} kicker={c.proof.kicker} heading={c.proof.heading} intro={c.proof.intro} />
          <BlurFade delay={0.12} inView>
            <figure className="mt-8 max-w-3xl rounded-2xl border border-dashed border-border bg-card/60 p-8">
              <blockquote className="text-lg leading-relaxed text-muted-foreground">
                {c.proof.quotePlaceholder}
              </blockquote>
            </figure>
          </BlurFade>
        </div>
      </section>

      {/* ── 08 Insights ────────────────────────────────────────────────────── */}
      <section id="insights" className="relative border-b border-border bg-card/40">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <SectionHead number={c.insights.number} kicker={c.insights.kicker} heading={c.insights.heading} intro={c.insights.intro} />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {c.insights.articles.map((a, i) => (
              <BlurFade key={a.title} delay={0.06 * i} inView>
                <div className="flex h-full flex-col rounded-2xl border border-border bg-background p-5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Draft</span>
                  <h3 className="mt-2 text-sm font-semibold text-foreground">{a.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{a.summary}</p>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* ── 09 FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="relative border-b border-border">
        <div className="mx-auto grid max-w-[100rem] gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <SectionHead number={c.faq.number} kicker={c.faq.kicker} heading={c.faq.heading} />
            <BlurFade delay={0.12} inView>
              <div className="mt-6 rounded-2xl border border-border bg-card p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">{c.faq.asideKicker}</p>
                <p className="mt-2 text-base font-semibold text-foreground">{c.faq.asideHeading}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.faq.asideBody}</p>
                <Button asChild size="sm" className="mt-4">
                  <Link href={href('liveProduct')}>View the live product</Link>
                </Button>
              </div>
            </BlurFade>
          </div>
          <div className="grid gap-3">
            {c.faq.items.map((it, i) => (
              <BlurFade key={it.q} delay={0.05 * i} inView>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-sm font-semibold text-foreground">{it.q}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.a}</p>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ────────────────────────────────────────────────────── */}
      <section className="relative border-b border-border">
        <div className="mx-auto max-w-[100rem] px-4 py-16 sm:px-6 sm:py-20">
          <BlurFade inView>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
              <Path className="size-4" weight="bold" />
              {c.footer.ctaKicker}
            </p>
            <h2 className="mt-3 max-w-3xl text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              {c.footer.ctaHeading}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {c.footer.ctaBody}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href={href('liveProduct')}>
                  {c.footer.ctaButton}
                  <ArrowRight className="size-4" weight="bold" />
                </Link>
              </Button>
              <CtaButtons githubLabel="View the source" />
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {c.footer.trustBadges.map((b) => (
                <span key={b} className="rounded-full border border-border bg-card px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {b}
                </span>
              ))}
            </div>
          </BlurFade>
        </div>
      </section>

      <footer className="bg-background">
        <div className="mx-auto flex max-w-[100rem] flex-col items-center justify-between gap-2 px-4 py-8 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground sm:flex-row sm:px-6">
          <span>{c.footer.legal[0]} · {c.footer.legal[1]}</span>
          <span>{c.footer.companyDescription}</span>
        </div>
      </footer>
    </div>
  );
}

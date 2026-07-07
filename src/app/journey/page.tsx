import type { Icon } from '@phosphor-icons/react';
import {
  ArrowLeft,
  ArrowRight,
  ChartLineUp,
  Gauge,
  Lock,
  Plugs,
  Scroll,
  ShieldCheck,
  Stack,
} from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { MagicCard } from '@/components/ui/magic-card';
import { STAGES } from '@/lib/architecture';

export const dynamic = 'force-dynamic';

interface Diagram {
  img: string;
  badge: string;
  title: string;
  body: string;
}

const DIAGRAMS: Diagram[] = [
  {
    img: 'og-05-components-value',
    badge: 'Every component, one page',
    title: 'What each part does — and the value it brings',
    body: 'The whole agentic stack on a single page: every component across all five layers, each with the concrete value it delivers, funnelled through one gateway. Every box is replaceable open source behind a port — self-hosted, no per-token fees, no API keys, no lock-in.',
  },
  {
    img: 'og-01-five-planes',
    badge: 'The whole system',
    title: 'One control plane, five layers',
    body: 'Data, control, AI, regulatory, and the consumption layer — every layer of the agentic stack, held by one console. The spine running through them is the part you own; each box is a real, named component doing a real job.',
  },
  {
    img: 'og-02-request-lifecycle',
    badge: 'Stage 1 — sanctioned access',
    title: 'Every request, governed',
    body: 'A single gateway sits between every employee and every model. Each prompt is scanned for PII, checked against policy, routed, answered from versioned knowledge, citation-verified, and written to one append-only audit log. One switch halts it all.',
  },
  {
    img: 'og-03-capability-ports',
    badge: 'No lock-in',
    title: 'Swap any component, one line',
    body: 'The console talks to capability ports, not tools. Each capability ships a first-party default and one or two open-source swap-ins, selectable by an environment variable. If an OSS service is unreachable, the port falls back to the default — a swap is never a hard dependency.',
  },
  {
    img: 'og-04-deployment-topology',
    badge: "What's bundled",
    title: 'Run only what you license',
    body: 'Everything ships as Docker Compose profiles that map one-to-one to capabilities. Only the console, the gateway, and Postgres are required — the rest comes up only when you ask for it. It runs on your own infrastructure; nothing routes through a server we own.',
  },
];

interface Guarantee {
  icon: Icon;
  title: string;
  body: string;
}

const GUARANTEES: Guarantee[] = [
  {
    icon: Lock,
    title: 'Local-first',
    body: 'Runs on your infrastructure. Models run on-device; data stays in your control.',
  },
  {
    icon: Scroll,
    title: 'Auditable & provable',
    body: 'Every model/tool call + byte of egress on one append-only record — and every export is tamper-evident, signed and offline-verifiable.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliant',
    body: 'Guardrails, ABAC, and regulator report packs (IRDAI / RBI / SEBI / DPDP).',
  },
  {
    icon: Plugs,
    title: 'No lock-in',
    body: 'Permissive open source behind swappable ports — change any tool via one env var.',
  },
  {
    icon: Gauge,
    title: 'Proven agents',
    body: 'Automated QA: offline evals, online scoring on live traffic, and drift/degradation alerts.',
  },
];

function StageRow({ stage, last }: { stage: (typeof STAGES)[number]; last: boolean }) {
  return (
    <BlurFade inView>
      <div className="relative grid grid-cols-[auto_1fr] gap-5">
        <div className="flex flex-col items-center">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/10 font-semibold text-primary">
            {stage.n}
          </div>
          {!last ? <div className="mt-1 w-px flex-1 bg-border" aria-hidden /> : null}
        </div>
        <div className="pb-10">
          <h3 className="text-lg font-semibold tracking-tight">
            Stage {stage.n} · {stage.name}
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{stage.reality}</p>
          <div className="mt-3 max-w-2xl rounded-md border border-border bg-card/60 p-3">
            <span className="text-[10px] uppercase tracking-wide text-primary">
              With Off Grid AI Console
            </span>
            <p className="mt-1 text-sm text-foreground">{stage.console}</p>
          </div>
        </div>
      </div>
    </BlurFade>
  );
}

function DiagramBlock({ d, flip }: { d: Diagram; flip: boolean }) {
  return (
    <BlurFade inView>
      <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
        <div
          className={`overflow-hidden rounded-xl border border-border bg-[#ffffff] p-3 shadow-sm ${
            flip ? 'lg:order-last' : ''
          }`}
        >
          <Image
            src={`/diagrams/${d.img}.jpg`}
            alt={d.title}
            width={1024}
            height={572}
            className="h-auto w-full rounded-lg"
          />
        </div>
        <div>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {d.badge}
          </Badge>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">{d.title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{d.body}</p>
        </div>
      </div>
    </BlurFade>
  );
}

export default function JourneyPage() {
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
          <Button asChild size="sm">
            <Link href="/fleet">Open console</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-16">
        <BlurFade inView>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            <ChartLineUp className="mr-1 size-3.5" />
            The maturity journey
          </Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            From Shadow AI to a self-serve platform
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            Every enterprise is somewhere on this path. Off Grid AI Console is the platform that
            carries you from sanctioned access to an org-wide, auditable AI estate — one stage at a
            time.
          </p>
          <p className="mt-2 text-sm font-medium text-primary">
            Each stage earns the next. You can&apos;t skip.
          </p>
        </BlurFade>

        <BlurFade inView>
          <div className="relative mt-10 overflow-hidden rounded-xl border border-border bg-black p-2 shadow-sm">
            <Image
              src="/diagrams/journey-stages.jpg"
              alt="From Shadow AI to a self-serve platform — the six stages"
              width={1400}
              height={760}
              className="h-auto w-full rounded-lg"
              priority
            />
          </div>
        </BlurFade>

        <section className="mt-14">
          {STAGES.map((s, i) => (
            <StageRow key={s.n} stage={s} last={i === STAGES.length - 1} />
          ))}
        </section>
      </div>

      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <Stack className="size-6 text-primary" />
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              The platform that gets you there
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              The same architecture underpins every stage. Real components, labelled and connected —
              here is exactly what is in the box and how a request flows through it.
            </p>
          </BlurFade>
          <div className="mt-12 space-y-14">
            {DIAGRAMS.map((d, i) => (
              <DiagramBlock key={d.img} d={d} flip={i % 2 === 1} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-xl font-semibold tracking-tight">What a CIO can sign off on</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {GUARANTEES.map((g) => (
              <BlurFade key={g.title} inView>
                <MagicCard className="h-full rounded-xl border border-border p-5">
                  <g.icon className="size-5 text-primary" />
                  <h3 className="mt-3 text-sm font-semibold">{g.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{g.body}</p>
                </MagicCard>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Find your stage. Take the next one.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            See the live console, or read the reference architecture layer by layer.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href="/fleet">
                Open the console
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/architecture/a">Explore the architecture</Link>
            </Button>
          </div>
          <BorderBeam duration={12} size={300} colorFrom="#34d399" colorTo="#059669" />
        </div>
      </section>
    </div>
  );
}

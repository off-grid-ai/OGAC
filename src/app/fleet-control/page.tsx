import type { Icon } from '@phosphor-icons/react';
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Broadcast,
  Bug,
  ChartLineUp,
  CheckCircle,
  Desktop,
  DeviceMobile,
  Gauge,
  GearSix,
  GitBranch,
  Lock,
  MagnifyingGlass,
  MapPin,
  Package,
  ShieldCheck,
  Sparkle,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { MagicCard } from '@/components/ui/magic-card';

export const dynamic = 'force-dynamic';

interface Item {
  icon: Icon;
  name: string;
  body: string;
}

// Act 1 — the table-stakes a buyer already expects from "fleet control" (delivered via FleetDM +
// osquery, MIT core).
const BASELINE: Item[] = [
  {
    icon: Desktop,
    name: 'Device inventory & health',
    body: 'Hardware, OS, installed software, users, uptime, disk-encryption status — every device, always current.',
  },
  {
    icon: MagnifyingGlass,
    name: 'Live & scheduled queries',
    body: 'Ask any question across the whole fleet in real time (osquery): what’s installed, running, misconfigured — answered in seconds.',
  },
  {
    icon: ShieldCheck,
    name: 'Policies & compliance',
    body: 'Pass/fail posture per device — disk encrypted, firewall on, OS patched, screen-lock set — rolled up to a fleet compliance score.',
  },
  {
    icon: Package,
    name: 'Software & patch management',
    body: 'Install and update apps, enforce OS updates, and keep the fleet on approved versions.',
  },
  {
    icon: GearSix,
    name: 'Configuration & MDM commands',
    body: 'Enforce OS settings and configuration profiles; lock, wipe, or restart a device on demand.',
  },
  {
    icon: Bug,
    name: 'Vulnerability visibility',
    body: 'Installed software mapped to known CVEs, so you see exposure across the fleet, not one box at a time.',
  },
  {
    icon: GitBranch,
    name: 'GitOps & targeting',
    body: 'Group devices by label/team and manage all fleet config as version-controlled code.',
  },
  {
    icon: CheckCircle,
    name: 'Audit, alerts & dashboards',
    body: 'An activity feed of every change, webhooks on policy failures, and dashboards over the whole estate.',
  },
];

// Act 2 — the intelligence layer only Off Grid AI adds, on-device across desktop + mobile.
const INTELLIGENCE: Item[] = [
  {
    icon: UsersThree,
    name: 'Device → person → territory',
    body: 'Every host tied to the rep, role, and territory that owns it — so the fleet is a workforce, not just hardware.',
  },
  {
    icon: Broadcast,
    name: 'Activity & workflow intelligence',
    body: 'The Off Grid AI node on desktop AND mobile sees how work actually happens (screens, apps, calls — explicit opt-in) and turns it into signal.',
  },
  {
    icon: ChartLineUp,
    name: 'Field-force & sales intelligence',
    body: 'Playbook adherence, winning-pattern detection, and next-best-action — grounded in your own Brain, surfaced per rep and per region.',
  },
  {
    icon: Sparkle,
    name: 'On-device copilot, everywhere',
    body: 'Every rep carries your best rep — a private copilot on their desktop and phone, grounded in your playbooks, running on-device.',
  },
  {
    icon: Brain,
    name: 'Tacit knowledge → shared process',
    body: 'Watch how top performers work and distil it into citable SOPs the whole field force draws from — your know-how, captured.',
  },
  {
    icon: MapPin,
    name: 'Coverage & cohort insight',
    body: 'See adoption, productivity, and AI usage by team, region, and device cohort — where the fleet is winning and where it needs help.',
  },
];

const GOVERNANCE: Item[] = [
  { icon: Lock, name: 'One gateway + kill-switch', body: 'Every AI call on every device routes through one governed chokepoint you can halt instantly.' },
  { icon: ShieldCheck, name: 'Audit & policy per device', body: 'Append-only audit + ABAC over the whole fleet — defensible to a regulator.' },
  { icon: Gauge, name: 'Agent QA across the fleet', body: 'Evals, drift, and online scoring keep the on-device intelligence reliable as it scales.' },
];

function Cards({ items, cols }: { items: Item[]; cols: string }) {
  return (
    <div className={`mt-10 grid grid-cols-1 gap-5 ${cols}`}>
      {items.map((it) => (
        <BlurFade key={it.name} inView>
          <MagicCard className="h-full rounded-xl border border-border p-5">
            <it.icon className="size-6 text-primary" weight="duotone" />
            <h3 className="mt-3 text-sm font-semibold">{it.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{it.body}</p>
          </MagicCard>
        </BlurFade>
      ))}
    </div>
  );
}

export default function FleetControlPage() {
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
              <Link href="/features">All features</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/gateway/fleet">Open console</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <BlurFade inView>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Broadcast className="mr-1 size-3.5" />
              Fleet Control
            </Badge>
            <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
              Everything fleet control already means —{' '}
              <span className="text-primary">plus the intelligence only Off Grid AI adds.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base text-muted-foreground">
              A complete, competitive frontline fleet-control system on open source (FleetDM +
              osquery), with Off Grid AI’s field-force intelligence layered on top — across desktop and
              mobile, on your own infrastructure.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/gateway/fleet">
                  Open the console
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/features">See all features</Link>
              </Button>
            </div>
          </BlurFade>
        </div>
      </section>

      {/* Act 1 — baseline */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <Badge variant="secondary">Act 1 · Table stakes</Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              The fleet control buyers already expect
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              The baseline a competitive fleet-control system must do — every bit of it delivered on
              permissive open source (FleetDM + osquery), self-hosted, no per-device licence.
            </p>
          </BlurFade>
          <Cards items={BASELINE} cols="sm:grid-cols-2 lg:grid-cols-4" />
        </div>
      </section>

      {/* Act 2 — intelligence */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Sparkle className="mr-1 size-3.5" />
              Act 2 · The Off Grid AI moat
            </Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Fleet <span className="text-primary">intelligence</span> — desktop & mobile
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              FleetDM manages the devices. Off Grid AI turns the fleet into a workforce you can coach —
              on-device intelligence that no MDM gives you, captured (opt-in) on every desktop and
              phone and grounded in your own knowledge.
            </p>
          </BlurFade>
          <Cards items={INTELLIGENCE} cols="sm:grid-cols-2 lg:grid-cols-3" />
        </div>
      </section>

      {/* Governance strip */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <BlurFade inView>
            <h2 className="text-xl font-semibold tracking-tight">
              …and it’s all governed — because it’s fleet control for AI
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              The same console that manages the devices governs the AI running on them.
            </p>
          </BlurFade>
          <Cards items={GOVERNANCE} cols="sm:grid-cols-3" />
        </div>
      </section>

      {/* How it fits */}
      <section className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-xl font-semibold tracking-tight">How it fits together</h2>
          <div className="mt-6 flex flex-col gap-3 text-sm sm:flex-row sm:items-stretch">
            {[
              { icon: Desktop, t: 'FleetDM + osquery', d: 'The device-fleet engine — inventory, policy, compliance.' },
              { icon: DeviceMobile, t: 'Off Grid AI node (desktop + mobile)', d: 'The on-device signal — activity, capture, the copilot.' },
              { icon: Brain, t: 'The Brain', d: 'Your knowledge — what the intelligence is grounded in.' },
              { icon: Broadcast, t: 'The console', d: 'One control plane — governance, audit, kill-switch, insight.' },
            ].map((s, i, arr) => (
              <div key={s.t} className="flex flex-1 items-center gap-3">
                <div className="flex-1 rounded-xl border border-border bg-background p-4">
                  <s.icon className="size-5 text-primary" weight="duotone" />
                  <h3 className="mt-2 text-sm font-semibold">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
                </div>
                {i < arr.length - 1 ? (
                  <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Fleet control the market knows — intelligence only you have.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Open source, self-hosted, no per-device fees. Add the field-force intelligence on top.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href="/gateway/fleet">
                Open the console
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/handbook/catalog">See the components</Link>
            </Button>
          </div>
          <BorderBeam duration={12} size={300} colorFrom="#34d399" colorTo="#059669" />
        </div>
      </section>
    </div>
  );
}

'use client';

import { Database, ShieldCheck, Sparkle, Stack, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import type { OrgContextSummary } from '@/lib/org-context';

// ─── InheritanceBanner (Builder Epic Phase 3A) ────────────────────────────────────────────────────
// The "you're not starting from zero" banner. Renders the PURE OrgContextSummary (counts + names,
// zero secrets) so a builder can see, at a glance, everything a new app inherits from its org:
// connectors, tools, data domains, guardrails, and the active policy version. Founder's ask: the
// builder should feel generous and governed — this is what proves it.
export function InheritanceBanner({ summary }: Readonly<{ summary: OrgContextSummary }>) {
  const chips: { icon: React.ReactNode; label: string; title?: string }[] = [
    {
      icon: <TreeStructure className="size-3.5" />,
      label: `${summary.connectors.count} connector${summary.connectors.count === 1 ? '' : 's'}`,
      title: summary.connectors.names.join(', ') || undefined,
    },
    {
      icon: <Database className="size-3.5" />,
      label: `${summary.dataDomains.count} data domain${summary.dataDomains.count === 1 ? '' : 's'}`,
      title: summary.dataDomains.names.join(', ') || undefined,
    },
    {
      icon: <Sparkle className="size-3.5" />,
      label: `${summary.tools.count} tool${summary.tools.count === 1 ? '' : 's'}`,
      title: summary.tools.names.join(', ') || undefined,
    },
    {
      icon: <Stack className="size-3.5" />,
      label: `${summary.brain.documentCount} KB doc${summary.brain.documentCount === 1 ? '' : 's'}`,
    },
    {
      icon: <ShieldCheck className="size-3.5" />,
      label: summary.guardrails.on ? 'guardrails on' : 'guardrails off',
    },
  ];

  return (
    <div className="rounded-md border border-primary/25 bg-primary/[0.04] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-primary/80">
          This app inherits
        </span>
        {chips.map((c, i) => (
          <span
            key={i}
            title={c.title}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
          >
            {c.icon}
            {c.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
          policy v{summary.policy.version}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Every step runs through your org&apos;s governed pipeline — policy, guardrails, routing, and
        provenance are applied automatically. You don&apos;t wire any of it.
      </p>
    </div>
  );
}

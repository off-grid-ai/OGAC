import { ArrowRight, ShieldCheck, ShieldSlash, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { BlockingDecision, HomeTile, OperatorHome } from '@/lib/overview-synthesis';
import { cn } from '@/lib/utils';

// Presentational pieces for the operator home. Pure render — every datum comes from the synthesized
// OperatorHome view-model (src/lib/overview-synthesis.ts); nothing fetches or decides here. Page
// motion (og-page-enter) is applied globally by PageTransition, so these don't animate themselves.

const TONE: Record<HomeTile['tone'], string> = {
  good: 'text-primary',
  warn: 'text-amber-600',
  bad: 'text-destructive',
  muted: 'text-foreground',
};

export function TileCard({ t }: { t: HomeTile }) {
  return (
    <Link
      href={t.href}
      className="group rounded-lg border border-border bg-card p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">{t.label}</div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', TONE[t.tone])}>{t.value}</div>
      {t.hint ? <div className="mt-1 text-xs text-muted-foreground">{t.hint}</div> : null}
    </Link>
  );
}

export function Section({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <Link
          href={href}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          {linkLabel} <ArrowRight className="size-3" />
        </Link>
      </div>
      {children}
    </section>
  );
}

const KIND_STYLE: Record<BlockingDecision['kind'], string> = {
  blocked: 'bg-destructive/10 text-destructive',
  denied: 'bg-destructive/10 text-destructive',
  redacted: 'bg-amber-500/10 text-amber-600',
};

const SOURCE_LABEL: Record<BlockingDecision['source'], string> = {
  audit: 'Audit',
  policy: 'Policy',
  guardrails: 'Guardrails',
};

// The cross-module blocking feed: audit ∪ policy ∪ guardrails, last 24h. Each row deep-links into
// the module that produced it, so an operator can go straight from "something was stopped" to the
// full record.
export function BlockingFeed({ blocking }: { blocking: OperatorHome['blocking'] }) {
  const clear = blocking.total === 0;
  return (
    <Section
      title={`Blocking decisions (last ${blocking.windowHours}h)`}
      href="/governance"
      linkLabel="Governance"
    >
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <div className="flex items-start gap-2 border-b border-border px-4 py-3">
            {clear ? (
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" weight="fill" />
            ) : (
              <ShieldSlash className="mt-0.5 size-4 shrink-0 text-amber-600" weight="fill" />
            )}
            <p className="text-sm text-foreground">{blocking.summary}</p>
          </div>
          {clear ? null : (
            <div className="divide-y divide-border">
              {blocking.items.map((i) => (
                <Link
                  key={i.id}
                  href={i.href}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">{i.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{i.subject}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {SOURCE_LABEL[i.source]}
                    </span>
                    <Badge variant="secondary" className={KIND_STYLE[i.kind]}>
                      {i.kind}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

export function ServicesCard({ health }: { health: OperatorHome['health'] }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="divide-y divide-border p-0">
        {health.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No services probed.</p>
        ) : (
          health.items.map((svc) => (
            <div key={svc.id} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-foreground">{svc.label}</span>
              <div className="flex items-center gap-2">
                {svc.ms !== null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">{svc.ms} ms</span>
                ) : null}
                <Badge
                  variant="secondary"
                  className={
                    svc.status === 'up'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-destructive/10 text-destructive'
                  }
                >
                  {svc.status}
                </Badge>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function ActivityCard({ activity }: { activity: OperatorHome['activity'] }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="divide-y divide-border p-0">
        {activity.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nothing has run yet. Kick off your first agent from{' '}
            <Link href="/workspace/chat" className="text-primary hover:underline">
              chat
            </Link>
            .
          </p>
        ) : (
          activity.map((r) => (
            <Link
              key={r.id}
              href={`/build/agent-runs?run=${r.id}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Sparkle className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm text-foreground">{r.query || r.agentId}</span>
              </span>
              <Badge
                variant="secondary"
                className={
                  r.status === 'blocked' || r.status === 'denied'
                    ? 'bg-destructive/10 text-destructive'
                    : r.status === 'done'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                }
              >
                {r.status}
              </Badge>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

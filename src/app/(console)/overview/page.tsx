import {
  ArrowRight,
  ChatCircle,
  Database,
  FileText,
  Plus,
  ShieldCheck,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/auth';
import { type HomeStat, buildHomeOverview } from '@/lib/home-view';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TONE: Record<HomeStat['tone'], string> = {
  good: 'text-primary',
  warn: 'text-amber-600',
  bad: 'text-destructive',
  muted: 'text-foreground',
};

function StatCard({ s }: { s: HomeStat }) {
  return (
    <Link
      href={s.href}
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">{s.label}</div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', TONE[s.tone])}>{s.value}</div>
      {s.hint ? <div className="mt-1 text-xs text-muted-foreground">{s.hint}</div> : null}
    </Link>
  );
}

function Section({
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

const QUICK_ACTIONS = [
  { label: 'Open chat', href: '/chat', icon: ChatCircle },
  { label: 'Add data source', href: '/integrations', icon: Plus },
  { label: 'Review policy', href: '/policy', icon: ShieldCheck },
  { label: 'Add knowledge', href: '/knowledge', icon: Database },
  { label: 'Generate report', href: '/reports', icon: FileText },
];

export default async function ConsoleHome() {
  const session = await auth();
  const o = await buildHomeOverview();
  const firstName = session?.user?.name?.split(' ')[0] ?? session?.user?.email?.split('@')[0];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {firstName ? `Welcome back, ${firstName}` : 'Overview'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your private intelligence platform at a glance — what it&apos;s doing, what it&apos;s
          costing, and whether it&apos;s controlled.
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <a.icon className="size-4" />
            {a.label}
          </Link>
        ))}
      </div>

      {o.posture.length > 0 ? (
        <Section title="Governance posture" href="/control" linkLabel="Governance">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {o.posture.map((s) => (
              <StatCard key={s.label} s={s} />
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {o.spend.length > 0 ? (
          <Section title="Cost" href="/finops" linkLabel="FinOps">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {o.spend.map((s) => (
                <StatCard key={s.label} s={s} />
              ))}
            </div>
          </Section>
        ) : null}

        {o.traffic.length > 0 ? (
          <Section title="Traffic & health" href="/analytics" linkLabel="Analytics">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {o.traffic.map((s) => (
                <StatCard key={s.label} s={s} />
              ))}
            </div>
          </Section>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Services health */}
        <Section
          title={`Services (${o.services.up}/${o.services.total} up)`}
          href="/services"
          linkLabel="All services"
        >
          <Card className="shadow-sm">
            <CardContent className="divide-y divide-border p-0">
              {o.services.items.map((svc) => (
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
              ))}
            </CardContent>
          </Card>
        </Section>

        {/* Recent activity */}
        <Section title="Recent activity" href="/agent-runs" linkLabel="All runs">
          <Card className="shadow-sm">
            <CardHeader className="sr-only">
              <CardTitle>Recent agent runs</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {o.activity.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  No agent runs yet. Start one from{' '}
                  <Link href="/chat" className="text-primary hover:underline">
                    chat
                  </Link>
                  .
                </p>
              ) : (
                o.activity.map((r) => (
                  <Link
                    key={r.id}
                    href={`/agent-runs?run=${r.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className="truncate text-sm text-foreground">{r.query || r.agentId}</span>
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
        </Section>
      </div>
    </div>
  );
}

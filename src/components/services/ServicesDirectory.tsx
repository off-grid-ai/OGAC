'use client';

import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { toDisplayHost, toDisplayHostname } from '@/lib/display-host';
import { isHealthy, type ServiceEntry, type ServiceHealth } from '@/lib/services-directory';

const AUTH_LABEL: Record<ServiceEntry['auth'], string> = {
  session: 'Login',
  'api-key': 'API key',
  public: 'Public',
};

const KIND_GROUPS: { kind: ServiceEntry['kind']; label: string }[] = [
  { kind: 'console', label: 'Console' },
  { kind: 'gateway', label: 'Gateway' },
  { kind: 'api', label: 'Internal services' },
  { kind: 'product', label: 'Products' },
  { kind: 'site', label: 'Sites' },
];

// Presentation for each honest health state. Embedded backends and optional deps on their
// fallback are healthy (emerald/muted) — never the alarming red reserved for a real outage.
const HEALTH_UI: Record<ServiceHealth['status'], { dot: string; text: string; label: string }> = {
  up: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Up' },
  down: { dot: 'bg-red-500', text: 'text-red-500', label: 'Down' },
  embedded: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Embedded' },
  optional: { dot: 'bg-muted-foreground/50', text: 'text-muted-foreground', label: 'Optional' },
};

function HealthDot({ h }: Readonly<{ h: ServiceHealth | undefined }>) {
  if (!h) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" /> checking
      </span>
    );
  }
  const ui = HEALTH_UI[h.status];
  const down = h.status === 'down';
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={`size-2 shrink-0 rounded-full ${ui.dot}`} />
      <span className={ui.text}>{ui.label}</span>
      {h.ms != null && <span className="text-muted-foreground">{h.ms}ms</span>}
      {h.detail && <span className="truncate text-muted-foreground" title={h.detail}>{h.detail}</span>}
      {down && h.error && <span className="truncate text-muted-foreground" title={h.error}>{h.error}</span>}
    </span>
  );
}

function ServiceCard({ s, h }: Readonly<{ s: ServiceEntry; h: ServiceHealth | undefined }>) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/gateway/services/${s.id}`} className="text-sm font-medium text-foreground hover:text-primary">
          {s.label}
        </Link>
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px] uppercase">{AUTH_LABEL[s.auth]}</Badge>
      </div>
      <p className="flex-1 text-xs text-muted-foreground">{s.description}</p>
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2">
        <HealthDot h={h} />
        {/^https?:\/\//i.test(s.url) ? (
          <a
            href={toDisplayHost(s.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground hover:text-primary"
          >
            {toDisplayHostname(s.url)}
            <ArrowSquareOut className="size-3 shrink-0" />
          </a>
        ) : (
          // Embedded/in-process backend — no external URL to open.
          <span className="truncate font-mono text-[11px] text-muted-foreground">in-process</span>
        )}
      </div>
    </div>
  );
}

export function ServicesDirectory({ services }: Readonly<{ services: ServiceEntry[] }>) {
  const [health, setHealth] = useState<Record<string, ServiceHealth>>({});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/v1/services/health', { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { services: ServiceHealth[]; checkedAt: string };
        setHealth(Object.fromEntries(data.services.map((s) => [s.id, s])));
        setCheckedAt(data.checkedAt);
      } catch { /* keep last-known */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const upCount = Object.values(health).filter((h) => isHealthy(h.status)).length;
  const checkedCount = Object.keys(health).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Services</h1>
          <p className="text-sm text-muted-foreground">
            Every Off Grid AI surface and internal service with live health.
          </p>
        </div>
        {checkedAt && (
          <div className="text-right font-mono text-xs text-muted-foreground">
            <span className={upCount === checkedCount ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}>
              {upCount}/{checkedCount} healthy
            </span>
            <div className="text-[10px] text-muted-foreground">checked {new Date(checkedAt).toLocaleTimeString()}</div>
          </div>
        )}
      </div>

      {/* Grouped sections — each group is a quiet header + one consistent responsive grid,
          so a single-card group (Console, Gateway) fills exactly one cell instead of a
          wasteful full-width row. */}
      {KIND_GROUPS.map(({ kind, label }) => {
        const group = services.filter((s) => s.kind === kind);
        if (group.length === 0) return null;
        const groupUp = group.filter((s) => { const st = health[s.id]?.status; return st != null && isHealthy(st); }).length;
        const groupChecked = group.filter((s) => health[s.id]).length;
        return (
          <section key={kind} className="space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
              {groupChecked > 0 && (
                <span className={`font-mono text-[11px] ${groupUp === groupChecked ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                  {groupUp}/{groupChecked}
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.map((s) => (
                <ServiceCard key={s.id} s={s} h={health[s.id]} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

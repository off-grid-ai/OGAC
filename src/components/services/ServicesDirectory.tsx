'use client';

import { ArrowSquareOut, CircleNotch } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { ServiceEntry, ServiceHealth } from '@/lib/services-directory';

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

function HealthDot({ h }: { h: ServiceHealth | undefined }) {
  if (!h) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleNotch className="size-3 animate-spin" /> checking
      </span>
    );
  }
  const up = h.status === 'up';
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={`size-2 shrink-0 rounded-full ${up ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <span className={up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
        {up ? 'Up' : 'Down'}
      </span>
      {h.ms != null && <span className="text-muted-foreground">{h.ms}ms</span>}
      {!up && h.error && <span className="truncate text-muted-foreground" title={h.error}>{h.error}</span>}
    </span>
  );
}

function ServiceCard({ s, h }: { s: ServiceEntry; h: ServiceHealth | undefined }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{s.label}</span>
        <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px] uppercase">{AUTH_LABEL[s.auth]}</Badge>
      </div>
      <p className="flex-1 text-xs text-muted-foreground">{s.description}</p>
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2">
        <HealthDot h={h} />
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground hover:text-primary"
        >
          {s.url.replace(/^https?:\/\//, '').split('/')[0]}
          <ArrowSquareOut className="size-3 shrink-0" />
        </a>
      </div>
    </div>
  );
}

export function ServicesDirectory({ services }: { services: ServiceEntry[] }) {
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

  const upCount = Object.values(health).filter((h) => h.status === 'up').length;
  const checkedCount = Object.keys(health).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Services</h1>
          <p className="text-sm text-muted-foreground">
            Every Off Grid surface and internal service with live health.
          </p>
        </div>
        {checkedAt && (
          <div className="text-right font-mono text-xs text-muted-foreground">
            <span className={upCount === checkedCount ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}>
              {upCount}/{checkedCount} up
            </span>
            <div className="text-[10px] text-muted-foreground">checked {new Date(checkedAt).toLocaleTimeString()}</div>
          </div>
        )}
      </div>

      {/* Grouped sections */}
      {KIND_GROUPS.map(({ kind, label }) => {
        const group = services.filter((s) => s.kind === kind);
        if (group.length === 0) return null;
        const groupUp = group.filter((s) => health[s.id]?.status === 'up').length;
        const groupChecked = group.filter((s) => health[s.id]).length;
        return (
          <div key={kind} className="rounded-lg border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
              {groupChecked > 0 && (
                <span className={`font-mono text-[11px] ${groupUp === groupChecked ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                  {groupUp}/{groupChecked}
                </span>
              )}
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((s) => (
                <ServiceCard key={s.id} s={s} h={health[s.id]} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { ArrowSquareOut, CircleNotch } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ServiceEntry, ServiceHealth } from '@/lib/services-directory';

const AUTH_LABEL: Record<ServiceEntry['auth'], string> = {
  session: 'Login',
  'api-key': 'API key',
  public: 'Public',
};

function HealthDot({ h }: { h: ServiceHealth | undefined }) {
  if (!h) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleNotch className="size-3.5 animate-spin" /> checking
      </span>
    );
  }
  const up = h.status === 'up';
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={`size-2 rounded-full ${up ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <span className={up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>
        {up ? 'Operational' : 'Down'}
      </span>
      {h.ms != null ? <span className="text-muted-foreground">· {h.ms}ms</span> : null}
      {h.httpStatus != null ? <span className="text-muted-foreground">· {h.httpStatus}</span> : null}
    </span>
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
      } catch {
        /* keep last-known */
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const upCount = Object.values(health).filter((h) => h.status === 'up').length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Services</h1>
          <p className="text-sm text-muted-foreground">
            Every Off Grid surface in one place, with live health. One console login covers them all.
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {checkedAt ? (
            <>
              {upCount}/{services.length} operational
              <div className="text-[10px]">refreshed {new Date(checkedAt).toLocaleTimeString()}</div>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <Card key={s.id} className="flex flex-col shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{s.label}</CardTitle>
                <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                  {AUTH_LABEL[s.auth]}
                </Badge>
              </div>
              <CardDescription>{s.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto space-y-3">
              <HealthDot h={health[s.id]} />
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
              >
                {s.url.replace('https://', '')}
                <ArrowSquareOut className="size-3.5" />
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

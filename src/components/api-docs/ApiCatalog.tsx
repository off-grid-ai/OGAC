'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  API_CATALOG,
  type ApiEndpoint,
  type AuthLevel,
  type HttpMethod,
} from '@/lib/api-catalog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The API docs & playground surface. The catalog comes from the pure `src/lib/api-catalog` module
// (single source of truth). The active area filter lives in the `?area=` query string — navigation
// is URL/history-driven (shareable, bookmarkable, survives refresh), never client-only state.

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  POST: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  PUT: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  PATCH: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DELETE: 'bg-destructive/15 text-destructive',
};

const AUTH_VARIANT: Record<AuthLevel, 'secondary' | 'outline' | 'default'> = {
  public: 'secondary',
  user: 'outline',
  admin: 'default',
};

const AUTH_LABEL: Record<AuthLevel, string> = {
  public: 'public',
  user: 'user',
  admin: 'admin',
};

function TryIt({ endpoint }: { endpoint: ApiEndpoint }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [status, setStatus] = useState<number | null>(null);
  const [body, setBody] = useState<string>('');

  async function run(): Promise<void> {
    setState('loading');
    setStatus(null);
    setBody('');
    try {
      const res = await fetch(endpoint.path, { headers: { accept: 'application/json' } });
      setStatus(res.status);
      const text = await res.text();
      try {
        setBody(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setBody(text);
      }
      setState('done');
    } catch (err) {
      setState('error');
      setBody(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <Button size="sm" variant="outline" onClick={run} disabled={state === 'loading'}>
        {state === 'loading' ? 'Running…' : 'Try it'}
      </Button>
      {(state === 'done' || state === 'error') && (
        <div className="space-y-1">
          {status !== null && (
            <div className="text-xs text-muted-foreground">
              HTTP <span className="font-mono">{status}</span>
            </div>
          )}
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
            {body}
          </pre>
        </div>
      )}
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: ApiEndpoint }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded px-2 py-0.5 font-mono text-xs font-semibold',
            METHOD_STYLES[endpoint.method],
          )}
        >
          {endpoint.method}
        </span>
        <code className="font-mono text-sm text-foreground">{endpoint.path}</code>
        <Badge variant={AUTH_VARIANT[endpoint.auth]} className="ml-auto">
          {AUTH_LABEL[endpoint.auth]}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{endpoint.summary}</p>
      {endpoint.params && endpoint.params.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {endpoint.params.map((p) => (
            <li key={`${p.in}:${p.name}`}>
              <span className="font-mono text-foreground">{p.name}</span>
              <span className="opacity-70"> · {p.in}</span>
              {p.required ? <span className="text-destructive"> · required</span> : null}
              {p.description ? <span className="opacity-70"> — {p.description}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {endpoint.safeGet && endpoint.method === 'GET' ? <TryIt endpoint={endpoint} /> : null}
    </div>
  );
}

export function ApiCatalog() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const areas = API_CATALOG.map((a) => a.area);
  const requested = params.get('area');
  const active = requested && areas.includes(requested) ? requested : 'All';

  const setArea = (area: string): void => {
    const next = new URLSearchParams(params.toString());
    if (area === 'All') next.delete('area');
    else next.set('area', area);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const visible = active === 'All' ? API_CATALOG : API_CATALOG.filter((a) => a.area === active);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {['All', ...areas].map((area) => (
          <button
            key={area}
            type="button"
            onClick={() => setArea(area)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              active === area
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {area}
          </button>
        ))}
      </div>

      {visible.map((area) => (
        <section key={area.area} className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{area.area}</h2>
            <p className="text-xs text-muted-foreground">{area.description}</p>
          </div>
          <div className="space-y-2">
            {area.endpoints.map((e) => (
              <EndpointRow key={`${e.method} ${e.path}`} endpoint={e} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

'use client';

import { CheckCircle, Info, Warning, XCircle } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Honest status of the CLOUD egress providers wired behind the routing framework (GET
// /api/v1/gateway/providers). A cloud model is only genuinely usable when the provider is CONFIGURED
// (base URL + API key in env) AND reachable AND the org egress switch is ON — a cloud route with
// egress off is leashed to block. This surface shows all three truths and NEVER shows a key. It marks
// each provider available/unavailable so the console never pretends a cloud model works when it can't.

interface ProviderRow {
  id: string;
  label: string;
  baseUrl: string;
  configured: boolean;
  defaultModel: string;
  prefixes: string[];
  health: 'up' | 'down' | 'unconfigured';
  probeStatus: number;
  available: boolean;
}
interface ProvidersResponse {
  egressAllowed: boolean;
  providers: ProviderRow[];
  error?: string;
}

export function GatewayProviders() {
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/gateway/providers', { cache: 'no-store' });
        const body = (await r.json().catch(() => ({}))) as ProvidersResponse;
        if (!alive) return;
        if (!r.ok) {
          setApiError(body.error ?? `HTTP ${r.status}`);
        } else {
          setData(body);
        }
      } catch {
        if (alive) setApiError('unreachable');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading cloud providers…</p>;
  if (apiError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <Warning size={13} className="mt-0.5 shrink-0" />
        <div>
          {apiError === 'forbidden' ? (
            <><span className="font-medium">Admin access required.</span> Cloud providers are admin-only.</>
          ) : apiError === 'unreachable' ? (
            <><span className="font-medium">Couldn&apos;t reach the console API.</span></>
          ) : (
            <><span className="font-medium">Failed to load providers:</span> {apiError}</>
          )}
        </div>
      </div>
    );
  }

  const providers = data?.providers ?? [];
  const anyConfigured = providers.some((p) => p.configured);

  return (
    <div className="space-y-4">
      {/* The master leash — cloud egress state, stated plainly. */}
      <div
        className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
          data?.egressAllowed
            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
            : 'border-border bg-muted/40 text-muted-foreground'
        }`}
      >
        <Info size={13} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-medium text-foreground">
            Cloud egress is {data?.egressAllowed ? 'ON' : 'OFF'}.
          </span>{' '}
          {data?.egressAllowed
            ? 'Requests a routing rule sends to cloud (and only those — PII/blocked never leave) will reach a configured provider. Turn egress off in Policy to hard-stop all cloud.'
            : 'Every cloud route is leashed to block — nothing leaves the box regardless of what is configured. Turn egress on in Policy to allow permitted (e.g. public) traffic out.'}
        </div>
      </div>

      {!anyConfigured && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Warning size={13} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-medium text-foreground">No cloud provider configured.</span> Cloud
            routes fall back to local (honest degradation) — the console never fabricates a cloud
            answer. Set <code className="font-mono">OFFGRID_CLOUD_OPENAI_API_KEY</code>,{' '}
            <code className="font-mono">OFFGRID_CLOUD_ANTHROPIC_API_KEY</code>, or{' '}
            <code className="font-mono">OFFGRID_CLOUD_COMPAT_BASE_URL</code>+
            <code className="font-mono">_API_KEY</code> to wire one.
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((p) => {
          const dot =
            p.health === 'up'
              ? 'bg-emerald-500'
              : p.health === 'down'
                ? 'bg-red-500'
                : 'bg-muted-foreground/40';
          return (
            <Card key={p.id} className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`inline-block size-2 rounded-full ${dot}`} />
                    {p.label}
                  </span>
                  {p.available ? (
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      <CheckCircle className="size-3" /> available
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">
                      <XCircle className="size-3" />
                      {p.configured ? (p.health === 'down' ? 'unreachable' : 'leashed') : 'not configured'}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0 text-xs text-muted-foreground">
                <p className="truncate font-mono text-[11px]" title={p.baseUrl}>
                  {p.baseUrl || '—'}
                </p>
                <p>
                  Default model:{' '}
                  <span className="font-mono text-foreground">{p.defaultModel || '—'}</span>
                </p>
                <p className="text-[11px]">
                  Routes model tags:{' '}
                  <span className="font-mono">{p.prefixes.slice(0, 4).join(', ')}</span>
                </p>
                {p.configured && p.health === 'down' && (
                  <p className="text-[11px] text-red-500">
                    Configured but not answering (probe status {p.probeStatus || 'timeout'}).
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { CheckCircle, Info, Warning, XCircle } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// The LiteLLM Proxy ROUTER — the professional load-balancer / failover / budget layer that sits
// behind the gateway's single endpoint (GET /api/v1/gateway/router). It shows every DEPLOYMENT the
// router balances across (the on-prem fleet nodes + the configured cloud models), each with its live
// per-deployment health, and the enforced key budgets. Honest by construction: when the router is not
// wired (OFFGRID_LITELLM_URL unset) it says so; when it's unreachable it says live:false — it never
// fakes a deployment. Mirrors GatewayProviders (same fetch/empty/error pattern, DRY).

interface Deployment {
  id: string;
  modelName: string;
  egress: 'on-prem' | 'cloud' | 'unknown';
  apiBase: string;
  health: 'healthy' | 'unhealthy' | 'unknown';
  vision: boolean;
}
interface Budget {
  keyAlias: string | null;
  spend: number;
  maxBudget: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
}
interface RouterResponse {
  configured: boolean;
  live: boolean;
  deployments: Deployment[];
  budgets: Budget[];
  error?: string;
}

export function GatewayRouter() {
  const [data, setData] = useState<RouterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/gateway/router', { cache: 'no-store' });
        const body = (await r.json().catch(() => ({}))) as RouterResponse;
        if (!alive) return;
        if (!r.ok) setApiError((body as { error?: string }).error ?? `HTTP ${r.status}`);
        else setData(body);
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading router…</p>;
  if (apiError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <Warning size={13} className="mt-0.5 shrink-0" />
        <div>
          {apiError === 'forbidden' ? (
            <><span className="font-medium">Admin access required.</span> The router is admin-only.</>
          ) : apiError === 'unreachable' ? (
            <span className="font-medium">Couldn&apos;t reach the console API.</span>
          ) : (
            <><span className="font-medium">Failed to load the router:</span> {apiError}</>
          )}
        </div>
      </div>
    );
  }

  const deployments = data?.deployments ?? [];
  const budgets = data?.budgets ?? [];

  // Not wired: the LiteLLM proxy env is unset — honest, actionable empty state.
  if (!data?.configured) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info size={13} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-medium text-foreground">Router not wired yet.</span> The gateway is
          still served by the built-in aggregator. Point the console at a LiteLLM Proxy by setting{' '}
          <code className="font-mono">OFFGRID_LITELLM_URL</code> and{' '}
          <code className="font-mono">OFFGRID_LITELLM_MASTER_KEY</code> to get health-checked
          load-balancing, automatic failover, and per-key budgets across the fleet + cloud.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Liveness band — the router's own up/down, stated plainly. */}
      <div
        className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
          data.live
            ? 'border-border bg-muted/40 text-muted-foreground'
            : 'border-destructive/40 bg-destructive/5 text-destructive'
        }`}
      >
        <Info size={13} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-medium text-foreground">
            Router is {data.live ? 'live' : 'unreachable'}.
          </span>{' '}
          {(() => {
            const errSuffix = data.error ? ` (${data.error})` : '';
            return data.live
              ? 'It load-balances across the deployments below with automatic failover + retries; per-key budgets and rate limits are enforced.'
              : `The console is wired to the router but it isn't answering${errSuffix}. Traffic falls back to the built-in aggregator.`;
          })()}
        </div>
      </div>

      {/* Deployments — the fleet nodes + cloud models the router balances across. */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Deployments ({deployments.length})
        </h3>
        {deployments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            The router reports no deployments yet — check the generated config.yaml.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {deployments.map((d) => {
              const dot =
                d.health === 'healthy'
                  ? 'bg-emerald-500'
                  : d.health === 'unhealthy'
                    ? 'bg-red-500'
                    : 'bg-muted-foreground/40';
              return (
                <Card key={d.id} className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className={`inline-block size-2 rounded-full ${dot}`} />
                        {d.id}
                      </span>
                      {d.health === 'healthy' ? (
                        <Badge variant="secondary" className="bg-primary/10 text-primary">
                          <CheckCircle className="size-3" /> healthy
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          <XCircle className="size-3" />
                          {d.health === 'unhealthy' ? 'unhealthy' : 'unknown'}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5 pt-0 text-xs text-muted-foreground">
                    <p className="truncate font-mono text-[11px] text-foreground" title={d.modelName}>
                      {d.modelName}
                    </p>
                    <p className="truncate font-mono text-[11px]" title={d.apiBase}>
                      {d.apiBase || '—'}
                    </p>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <Badge variant="outline" className="text-[10px]">
                        {d.egress}
                      </Badge>
                      {d.vision && (
                        <Badge variant="outline" className="text-[10px]">
                          vision
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Budgets — the enforced per-key ceilings the aggregator never had. */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Key budgets ({budgets.length})
        </h3>
        {budgets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No budgets reported — set a per-key budget on the router to enforce spend ceilings.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {budgets.map((b, i) => (
              <Card key={b.keyAlias ?? i} className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{b.keyAlias ?? 'master key'}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 pt-0 text-xs text-muted-foreground">
                  <p>
                    Spend:{' '}
                    <span className="font-mono text-foreground">${b.spend.toFixed(4)}</span>
                    {b.maxBudget !== null && (
                      <>
                        {' '}
                        / <span className="font-mono">${b.maxBudget.toFixed(2)}</span>
                      </>
                    )}
                  </p>
                  <p>
                    Rate limit:{' '}
                    <span className="font-mono text-foreground">
                      {b.rpmLimit !== null ? `${b.rpmLimit} rpm` : '—'}
                    </span>
                    {b.tpmLimit !== null && (
                      <span className="font-mono text-foreground"> · {b.tpmLimit} tpm</span>
                    )}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

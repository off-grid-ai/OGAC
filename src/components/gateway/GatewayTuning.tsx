'use client';

import { CheckCircle, Info, Lock, Warning, XCircle } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Read-only view of the aggregator's runtime TUNING (GET /api/v1/gateway/config →
// aggregator GET /config, shaped by the pure shapeGatewayTuning). These knobs are
// env-set in the aggregator's launchd plist on S1 and need a restart to change, so
// this surface is honestly READ-ONLY — no fake editable controls. It also states
// plainly what the router does NOT do (no cache, no fallback chain, rate-limit is
// the Caddy edge's job).

interface TuningRow {
  key: string;
  label: string;
  value: string;
  changeVia: string;
  description: string;
}
interface TuningGroup {
  group: string;
  rows: TuningRow[];
}
interface TuningCapability {
  key: string;
  label: string;
  present: boolean;
  note: string;
}
interface TuningResponse {
  available: boolean;
  tuning: {
    readonly: boolean;
    groups: TuningGroup[];
    capabilities: TuningCapability[];
  };
}

export function GatewayTuning() {
  const [data, setData] = useState<TuningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<
    'forbidden' | 'unauthorized' | (string & {}) | null
  >(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/gateway/config', { cache: 'no-store' });
        const body = (await r.json().catch(() => ({}))) as TuningResponse & { error?: string };
        if (!alive) return;
        if (!r.ok) {
          setApiError(body.error ?? `HTTP ${r.status}`);
          setData(null);
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading gateway tuning…</p>;

  if (apiError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <Warning size={13} className="mt-0.5 shrink-0" />
        <div>
          {apiError === 'forbidden' ? (
            <>
              <span className="font-medium">Admin access required.</span> Gateway tuning is admin-only.
            </>
          ) : apiError === 'unauthorized' ? (
            <><span className="font-medium">Session expired.</span> Sign in again.</>
          ) : apiError === 'unreachable' ? (
            <><span className="font-medium">Couldn&apos;t reach the console API.</span></>
          ) : (
            <><span className="font-medium">Failed to load tuning:</span> {apiError}</>
          )}
        </div>
      </div>
    );
  }

  const tuning = data?.tuning;

  return (
    <div className="space-y-4">
      {/* Read-only banner — this is deliberate, not a bug. */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Lock size={13} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-medium text-foreground">Read-only.</span> These are the aggregator&apos;s
          live tuning values. They&apos;re set from environment in the aggregator&apos;s launchd plist on S1 and
          take effect on restart — the router has no live-reconfigure endpoint, so the console reads them but
          doesn&apos;t fake an editable control. Routing (which nodes serve, their models) is edited in the{' '}
          <span className="font-medium text-foreground">Control</span> tab&apos;s Fleet configuration.
        </div>
      </div>

      {!data?.available && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <Warning size={13} />
          Aggregator is offline or predates the /config endpoint — showing defaults.
        </div>
      )}

      {tuning?.groups.map((g) => (
        <Card key={g.group} className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{g.group}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 pt-0 sm:grid-cols-2 lg:grid-cols-3">
            {g.rows.map((row) => (
              <div
                key={row.key}
                className="flex flex-col rounded-md border border-border bg-muted/20 px-3 py-2.5"
                title={`Change via: ${row.changeVia}`}
              >
                <span className="font-mono text-lg font-light leading-none text-primary">{row.value}</span>
                <span className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {row.label}
                </span>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">{row.description}</p>
                <p className="mt-auto pt-1.5 text-[10px] text-muted-foreground/50">Change via: {row.changeVia}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* Honest capability flags — what the router does NOT do. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Capabilities</CardTitle>
          <p className="text-xs text-muted-foreground">
            What this router does and doesn&apos;t provide — so nothing here pretends to be tunable when it isn&apos;t.
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5 pt-0">
          {tuning?.capabilities.map((c) => (
            <div key={c.key} className="flex items-start gap-2">
              {c.present ? (
                <CheckCircle size={14} className="mt-0.5 shrink-0 text-primary" weight="fill" />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  {c.label}
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {c.present ? 'available' : 'not present'}
                  </Badge>
                </span>
                <p className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
                  <Info size={11} className="mt-0.5 shrink-0" />
                  {c.note}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

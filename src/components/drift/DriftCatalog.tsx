'use client';

import { ChartLine, CheckCircle, Cube, Play } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type DriftAppliesTo,
  type DriftCatalogFilter,
  type DriftCatalogItem,
  type DriftEngineStatus,
  type DriftKind,
  DEFAULT_DRIFT_SHARE_THRESHOLD,
  DRIFT_APPLIES_TO,
  DRIFT_CATALOG,
  DRIFT_KINDS,
  catalogByKind,
  clampDriftShareThreshold,
  driftItemAvailability,
  filterDriftCatalog,
  isDriftFilterActive,
} from '@/lib/drift-catalog';

// Browse & apply the STANDARD Evidently drift catalog (Builder Epic #126). A non-technical operator
// searches/filters the bundled presets + per-column methods, sets the dataset drift-share threshold,
// and clicks Run — which POSTs the selection to /api/v1/admin/drift. That resolves it (pure,
// buildDriftRunConfig) to the run config and feeds the EXISTING drift run: Evidently when configured,
// else the built-in PSI heuristic (which still honors the threshold). No new engine, no fabricated
// score. All filter/availability logic is PURE in @/lib/drift-catalog; this component is thin.
// Search + kind + appliesTo + the selected item + threshold live in the URL so Back / deep-links work.

const KIND_LABEL: Record<DriftKind, string> = {
  preset: 'Presets',
  method: 'Methods',
};

const APPLIES_LABEL: Record<DriftAppliesTo, string> = {
  any: 'Any column',
  numerical: 'Numerical',
  categorical: 'Categorical',
  text: 'Text',
};

const AVAIL_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' }> = {
  ready: { label: 'Full test suite ready', variant: 'default' },
  fallback: { label: 'PSI fallback', variant: 'secondary' },
};

const VERDICT_CLASS: Record<string, string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-amber-500/10 text-amber-600',
  drift: 'bg-destructive/10 text-destructive',
};

interface RunResult {
  status: string;
  driftScore: number | null;
  engine: string;
  note: string | null;
}

export function DriftCatalog({ engineStatus }: Readonly<{ engineStatus: DriftEngineStatus }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  // URL-driven filter + selection state (navigational, not client-only).
  const filter: DriftCatalogFilter = useMemo(
    () => ({
      q: params.get('dc_q') ?? '',
      kind: (params.get('dc_kind') as DriftKind | null) ?? undefined,
      appliesTo: (params.get('dc_applies') as DriftAppliesTo | null) ?? undefined,
    }),
    [params],
  );
  const selectedId = params.get('dc_sel') ?? '';
  const threshold = clampDriftShareThreshold(
    params.get('dc_thr') ?? DEFAULT_DRIFT_SHARE_THRESHOLD,
  );

  const setParam = useCallback(
    (kv: Record<string, string>) => {
      const p = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(kv)) {
        if (value) p.set(key, value);
        else p.delete(key);
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const filtered = useMemo(() => filterDriftCatalog(DRIFT_CATALOG, filter), [filter]);
  const active = isDriftFilterActive(filter);
  const groups = useMemo(
    () => (active ? [{ kind: null as null, items: filtered }] : catalogByKind()),
    [active, filtered],
  );

  async function run() {
    if (!selectedId) {
      toast.error('Pick a preset or method first.');
      return;
    }
    setBusy(true);
    setResult(null);
    const res = await fetch('/api/v1/admin/drift', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: selectedId, driftShareThreshold: threshold }),
    });
    setBusy(false);
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.error || !body?.data) {
        toast.error(body?.error ?? 'Drift run failed');
        return;
      }
      const d = body.data as { status: string; driftScore: number | null; engine: string; note?: string | null };
      setResult({
        status: d.status,
        driftScore: d.driftScore,
        engine: d.engine,
        note: d.note ?? null,
      });
      toast.success(`Drift run complete — ${d.status}`);
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? 'Drift run failed');
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Pick a standard <span className="font-medium text-foreground">drift</span> preset or a
        per-column drift method, set how many columns must drift before the dataset counts as
        drifted, and run. When the drift collector is configured it runs the real test suite;
        otherwise the built-in PSI heuristic runs and still honors your threshold — no drift score is
        ever faked.
      </p>

      {/* Search + filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          placeholder="Search drift tests (e.g. PSI, KS, chi-square, data quality)…"
          value={filter.q}
          onChange={(e) => setParam({ dc_q: e.target.value })}
          className="sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={!filter.kind ? 'default' : 'outline'}
            onClick={() => setParam({ dc_kind: '' })}
          >
            All
          </Button>
          {DRIFT_KINDS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={filter.kind === k ? 'default' : 'outline'}
              onClick={() => setParam({ dc_kind: filter.kind === k ? '' : k })}
            >
              {KIND_LABEL[k]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DRIFT_APPLIES_TO.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={filter.appliesTo === a ? 'secondary' : 'ghost'}
              onClick={() => setParam({ dc_applies: filter.appliesTo === a ? '' : a })}
            >
              {APPLIES_LABEL[a]}
            </Button>
          ))}
        </div>
      </div>

      {/* Cards, grouped by kind when idle, flat when filtering */}
      {groups.every((g) => g.items.length === 0) ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No drift tests match your search.
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.kind ?? 'results'} className="space-y-2">
            {g.kind ? (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {KIND_LABEL[g.kind]}
              </h3>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.items.map((item: DriftCatalogItem) => {
                const avail = driftItemAvailability(item, engineStatus);
                const badge = AVAIL_BADGE[avail.status];
                const selected = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setParam({ dc_sel: selected ? '' : item.id })}
                    className={`flex flex-col gap-2 rounded-md border p-3 text-left transition-colors ${
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {item.kind === 'preset' ? (
                          <Cube className="size-4 shrink-0 text-primary" />
                        ) : (
                          <ChartLine className="size-4 shrink-0 text-primary" />
                        )}
                        <span className="text-sm font-medium text-foreground">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {item.recommended ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary">
                            recommended
                          </Badge>
                        ) : null}
                        {selected ? <CheckCircle className="size-4 text-primary" /> : null}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                    <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {item.evidentlyName}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {APPLIES_LABEL[item.appliesTo]}
                      </Badge>
                      <Badge variant={badge.variant} title={avail.detail}>
                        {badge.label}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Run bar — threshold + run + verdict */}
      <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="dc-thr" className="text-xs font-medium text-foreground">
              Dataset drift-share threshold
            </label>
            <Input
              id="dc-thr"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => setParam({ dc_thr: e.target.value })}
              className="w-28"
            />
            <span className="text-[11px] text-muted-foreground">
              Drift when this share of columns drift (0–1).
            </span>
          </div>
          {result ? (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary" className={VERDICT_CLASS[result.status] ?? ''}>
                {result.status}
              </Badge>
              <span className="text-muted-foreground">
                engine {result.engine}
                {result.driftScore !== null ? ` · score ${result.driftScore}` : ''}
              </span>
            </div>
          ) : null}
        </div>
        <Button onClick={() => void run()} disabled={busy || !selectedId}>
          <Play className="mr-1.5 size-4" />
          {busy ? 'Running…' : 'Run drift check'}
        </Button>
      </div>
      {result?.note ? <p className="text-xs text-muted-foreground">{result.note}</p> : null}
    </div>
  );
}

'use client';

import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type ModelFamily,
  type ModelSpec,
  type Modality,
  catalogByFamily,
  filterCatalog,
} from '@/lib/model-catalog';

// Shared client hook: fetch the model-spec catalog reconciled against the LIVE fleet SSOT
// (/api/v1/gateway/models). Both the routing-rule picker and the browsable Models panel use it, so
// there is one fetch/shape. On failure it yields an empty catalog (the caller shows a note).
export function useModelCatalog(): { models: ModelSpec[]; loading: boolean; error: boolean } {
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/gateway/models', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { data: ModelSpec[] };
        if (alive) setModels(Array.isArray(d.data) ? d.data : []);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return { models, loading, error };
}

const MODALITY_FACETS: (Modality | 'all')[] = ['all', 'text', 'vision', 'image', 'embedding'];

function ctxLabel(ctx: number | null): string {
  if (ctx === null) return 'ctx unknown';
  if (ctx >= 1000) return `${Math.round(ctx / 1024)}K ctx`;
  return `${ctx} ctx`;
}

// One selectable model row: id + name, family/modality/context, and a "live" badge when the fleet
// actually serves it. The whole row is a button so the picker is keyboard- and click-accessible.
function ModelRow({
  m,
  selected,
  onPick,
}: Readonly<{
  m: ModelSpec;
  selected: boolean;
  onPick: (m: ModelSpec) => void;
}>) {
  return (
    <button
      type="button"
      onClick={() => onPick(m)}
      aria-pressed={selected}
      className={`flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/40 hover:bg-accent'
      }`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="font-mono text-xs text-foreground">{m.id}</span>
        <div className="flex shrink-0 items-center gap-1">
          {m.servedOnFleet ? (
            <Badge variant="secondary" className="bg-primary/10 font-mono text-[10px] text-primary">
              live
            </Badge>
          ) : null}
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
            {m.modality}
          </Badge>
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{m.name}</span>
        <span className="font-mono">
          {ctxLabel(m.contextWindow)}
          {m.paramsB != null ? ` · ${m.paramsB}B` : ''}
        </span>
      </div>
    </button>
  );
}

// The browse-and-select body: search box + modality + fleet-only facets + a family-grouped list.
// Reused by BOTH the routing-rule picker sheet and the standalone Models panel.
export function ModelBrowser({
  models,
  loading,
  error,
  selectedId,
  onPick,
}: Readonly<{
  models: ModelSpec[];
  loading: boolean;
  error: boolean;
  selectedId?: string;
  onPick: (m: ModelSpec) => void;
}>) {
  const [query, setQuery] = useState('');
  const [modality, setModality] = useState<Modality | 'all'>('all');
  const [fleetOnly, setFleetOnly] = useState(false);

  const filtered = useMemo(
    () =>
      filterCatalog(models, {
        query,
        modality: modality === 'all' ? undefined : modality,
        fleetOnly,
      }),
    [models, query, modality, fleetOnly],
  );
  const groups = useMemo(() => catalogByFamily(filtered), [filtered]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models by name, id, or family…"
          className="pl-8"
          aria-label="Search models"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {MODALITY_FACETS.map((f) => (
          <Button
            key={f}
            type="button"
            size="xs"
            variant={modality === f ? 'default' : 'outline'}
            onClick={() => setModality(f)}
          >
            {f}
          </Button>
        ))}
        <Button
          type="button"
          size="xs"
          variant={fleetOnly ? 'default' : 'outline'}
          onClick={() => setFleetOnly((v) => !v)}
          title="Only models the fleet is currently serving"
        >
          live only
        </Button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-muted-foreground">Loading catalog…</div>
      ) : error ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          Couldn&apos;t load the model catalog.
        </div>
      ) : groups.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          No models match — adjust the search or facets.
        </div>
      ) : (
        <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g.family} className="space-y-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {g.family}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {g.models.map((m) => (
                  <ModelRow key={m.id} m={m} selected={m.id === selectedId} onPick={onPick} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { ModelSpec, ModelFamily, Modality };

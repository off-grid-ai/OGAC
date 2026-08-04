'use client';

import { Lightning, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { explainResponse } from '@/lib/api-failure';
import type { IndexRecommendation, PayloadIndex } from '@/lib/qdrant-payload-index';

interface State {
  indexes: PayloadIndex[];
  recommendations: IndexRecommendation[];
  points: number | null;
  summary: string;
}

// ─── Payload indexes for one retrieval collection ──────────────────────────────────────────────────
//
// Every governed retrieval filters on `org_id` — the tenant isolation boundary — and the deployed
// collection had NO payload index, so that filter was answered by scanning. This is the surface that makes
// it visible and fixable; the judgement (what to recommend, what counts as a field) is pure, in
// qdrant-payload-index.ts.
//
// Recommendations are one-click because the recommendation already names the right type. Making an
// operator retype `keyword` is how you get an index of the wrong type on the field that matters most.
export function PayloadIndexManager({ collectionName }: Readonly<{ collectionName: string }>) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const api = `/api/v1/admin/data/retrieval/collections/${encodeURIComponent(collectionName)}/payload-indexes`;

  const load = useCallback(async () => {
    const res = await fetch(api, { cache: 'no-store' });
    if (!res.ok) {
      // A refusal is not breakage — explainResponse keeps them apart so a viewer is not told the store
      // is broken when they simply may not administer it.
      setError((await explainResponse(res, 'Could not read the payload indexes.')).message);
      return;
    }
    setError(null);
    setState((await res.json()) as State);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(field: string, type: string) {
    setBusy(field);
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, type }),
      });
      if (!res.ok) {
        toast.error((await explainResponse(res, 'The index could not be created.')).message);
        return;
      }
      // The route returns the RE-READ state, so what lands here is what the store actually has.
      setState((await res.json()) as State);
      toast.success(`Indexed ${field}`);
    } finally {
      setBusy(null);
    }
  }

  async function drop(field: string) {
    setBusy(field);
    try {
      const res = await fetch(`${api}?field=${encodeURIComponent(field)}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error((await explainResponse(res, 'The index could not be dropped.')).message);
        return;
      }
      setState((await res.json()) as State);
      toast.success(`Dropped the index on ${field}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightning className="size-4 text-primary" weight="duotone" />
          Filter indexes
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          An index makes a filter cheap. Without one the store reads every point to answer it — which is
          invisible on a small collection and the first thing to slow down on a large one.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {error ? <p className="text-muted-foreground">{error}</p> : null}
        {!error && state === null ? <p className="text-muted-foreground">Reading…</p> : null}

        {state ? (
          <>
            <p className={state.recommendations.length > 0 ? 'text-foreground' : 'text-muted-foreground'}>
              {state.summary}
            </p>

            {state.recommendations.length > 0 ? (
              <div className="space-y-1.5">
                {state.recommendations.map((r) => (
                  <div
                    key={r.field}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/[0.04] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-foreground">
                        {r.field} <span className="text-muted-foreground">({r.type})</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">{r.why}</p>
                    </div>
                    {/* One click, with the type the rule already decided — retyping "keyword" is how the
                        field that matters most ends up indexed as the wrong type. */}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.field}
                      onClick={() => void create(r.field, r.type)}
                    >
                      <Plus className="size-3.5" />
                      {busy === r.field ? 'Indexing…' : 'Index it'}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {state.indexes.length > 0 ? (
              <div className="overflow-hidden rounded-md border border-border">
                {state.indexes.map((i) => (
                  <div
                    key={i.field}
                    className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <p className="min-w-0 font-mono text-[11px] text-foreground">
                      {i.field} <span className="text-muted-foreground">({i.type})</span>
                      {typeof i.points === 'number' ? (
                        <span className="ml-1.5 text-muted-foreground">· {i.points} indexed</span>
                      ) : null}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busy === i.field}
                      onClick={() => void drop(i.field)}
                    >
                      <Trash className="size-3.5" />
                      {busy === i.field ? 'Dropping…' : 'Drop'}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

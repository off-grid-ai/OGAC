'use client';

import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Pagination } from '@/components/ui/Pagination';
import { usePagination } from '@/lib/use-pagination';

interface Trace {
  id: string;
  name?: string | null;
  timestamp?: string;
  userId?: string | null;
  latency?: number | null;
  totalCost?: number | null;
}

interface Span {
  id: string;
  name: string;
  type: string;
  model?: string | null;
  offsetPct: number;
  widthPct: number;
  durationMs: number;
  depth: number;
}

// Langfuse read-back UI: a trace list; expanding one fetches its observations and renders a
// normalized span waterfall (offset + width in % of the trace's wall-clock).
function Waterfall({ traceId }: Readonly<{ traceId: string }>) {
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (spans === null && error === null) {
    fetch(`/api/v1/admin/traces/${encodeURIComponent(traceId)}`)
      .then((r) => r.json())
      .then((j: { spans?: Span[]; error?: string }) => {
        if (j.error) setError(j.error);
        setSpans(j.spans ?? []);
      })
      .catch((e) => setError((e as Error).message));
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading spans…</p>;
  }

  if (error) return <p className="px-3 py-2 text-xs text-destructive">{error}</p>;
  if (!spans?.length) return <p className="px-3 py-2 text-xs text-muted-foreground">No spans.</p>;

  return (
    <div className="space-y-1 px-3 py-2">
      {spans.map((s) => (
        <div key={s.id} className="flex items-center gap-2 text-xs">
          <span
            className="w-40 shrink-0 truncate text-muted-foreground"
            style={{ paddingLeft: s.depth * 10 }}
            title={s.name}
          >
            {s.name}
          </span>
          <div className="relative h-3 flex-1 rounded bg-muted">
            <div
              className="absolute h-3 rounded bg-primary/60"
              style={{ left: `${s.offsetPct}%`, width: `${s.widthPct}%` }}
              title={`${s.type}${s.model ? ` · ${s.model}` : ''}`}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-muted-foreground">
            {s.durationMs}ms
          </span>
        </div>
      ))}
    </div>
  );
}

export function LangfuseTraces({
  configured,
  traces,
  error,
}: Readonly<{
  configured: boolean;
  traces: Trace[];
  error?: string;
}>) {
  const [open, setOpen] = useState<string | null>(null);
  // Traces come from a server window that can be large; paginate the fetched list client-side.
  // URL-namespaced by `traces` so it deep-links and coexists with other lists on the page.
  const paged = usePagination(traces, { key: 'traces', defaultPageSize: 25 });

  if (!configured) {
    return (
      <p className="text-xs text-muted-foreground">
        Langfuse read-back not configured — set OFFGRID_LANGFUSE_URL + OFFGRID_LANGFUSE_PUBLIC_KEY /
        OFFGRID_LANGFUSE_SECRET_KEY (or reuse OFFGRID_LANGFUSE_AUTH) to pull traces back.
      </p>
    );
  }
  if (error) return <p className="text-xs text-destructive">Langfuse error: {error}</p>;
  if (!traces.length)
    return <p className="text-xs text-muted-foreground">No traces yet — run an agent to emit spans.</p>;

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border rounded-md border border-border">
        {paged.pageItems.map((t) => (
          <div key={t.id}>
            <button
              type="button"
              onClick={() => setOpen(open === t.id ? null : t.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
            >
              <CaretRight
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open === t.id ? 'rotate-90' : ''}`}
              />
              <span className="flex-1 truncate text-sm text-foreground">{t.name ?? t.id}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {t.latency != null ? `${Math.round(t.latency)}ms` : '—'}
              </span>
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                {t.timestamp?.slice(11, 19) ?? ''}
              </span>
            </button>
            {open === t.id ? <Waterfall traceId={t.id} /> : null}
          </div>
        ))}
      </div>
      <Pagination
        state={paged}
        onPageChange={paged.setPage}
        onPageSizeChange={paged.setPageSize}
        itemLabel="traces"
      />
    </div>
  );
}

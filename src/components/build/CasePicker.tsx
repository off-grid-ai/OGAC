'use client';

import { ArrowClockwise, Database } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CaseCandidate } from '@/lib/app-case-candidates';

// ─── Pick a case from the org's own data (GAP 0, the half a person touches) ───────────────────────────
//
// "why is this free text? all of the data is already in the organization right?" — it is, and this lists it.
// The app's first connector-query step declares the domain it reads, so these are the real records it works
// on. Selecting one passes the WHOLE RECORD to the run, so nothing is re-typed and nothing has to be parsed
// back out of prose.
//
// Every non-success case is explained rather than shown as an empty list: an unreachable source and an empty
// queue look identical otherwise, and they mean completely different things.

const REASON_COPY: Record<string, string> = {
  'no-data-domain': 'This app does not read from a data source, so there is nothing to choose from.',
  'domain-not-bound': 'This app reads a data source that is not connected yet.',
  'connector-missing': 'The connection behind this data source is missing.',
  'source-unavailable': 'That data source could not be reached just now.',
};

export function CasePicker({
  appId,
  onPick,
  selectedId,
}: Readonly<{
  appId: string;
  onPick: (candidate: CaseCandidate) => void;
  selectedId?: string | null;
}>) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | {
        status: 'ready';
        domain?: string;
        items: CaseCandidate[];
        reason?: string;
        settledHidden?: number;
      }
    | { status: 'error' }
  >({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch(`/api/v1/admin/apps/${encodeURIComponent(appId)}/case-candidates`);
      const data = (await res.json().catch(() => ({}))) as {
        data?: CaseCandidate[];
        domain?: string;
        reason?: string;
        settledHidden?: number;
      };
      if (!res.ok) {
        setState({ status: 'error' });
        return;
      }
      setState({
        status: 'ready',
        domain: data.domain,
        items: data.data ?? [],
        reason: data.reason,
        settledHidden: data.settledHidden ?? 0,
      });
    } catch {
      setState({ status: 'error' });
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return <p className="text-xs text-muted-foreground">Looking for cases…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        Could not look up cases.
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={() => void load()}>
          <ArrowClockwise className="size-3" />
          Try again
        </Button>
      </p>
    );
  }

  if (state.items.length === 0) {
    // Say WHICH of the several very different "nothing here" situations this is.
    return (
      <p className="text-xs text-muted-foreground">
        {(state.reason && REASON_COPY[state.reason]) ??
          'There is nothing waiting in that data source right now.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Database className="size-3.5 text-primary" />
        {state.domain ? `From your ${state.domain}` : 'From your data'} — pick the one to work on
      </p>
      {state.settledHidden ? (
        // Said out loud, because a silently shorter list looks like missing data.
        <p className="text-[11px] text-muted-foreground">
          {state.settledHidden} already settled and not shown.
        </p>
      ) : null}
      <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {state.items.map((item) => {
          const chosen = selectedId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item)}
              aria-pressed={chosen}
              className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                chosen ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60'
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
              {item.detail ? (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {item.detail}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

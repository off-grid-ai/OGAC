'use client';

import { TreeStructure } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Hit {
  sourceKind: 'kb' | 'database' | 'tool';
  title: string;
  snippet: string;
  ref: string;
  score: number;
}

interface RouteResult {
  decision: { intent: string[]; reason: string };
  hits: Hit[];
}

const KIND_STYLE: Record<string, string> = {
  kb: 'bg-primary/10 text-primary',
  database: 'bg-blue-500/10 text-blue-600',
  tool: 'bg-amber-500/10 text-amber-600',
};

export function RouterConsole() {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<RouteResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/retrieve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) throw new Error('failed');
      setResult((await res.json()) as RouteResult);
    } catch {
      toast.error('Routing failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={q}
          placeholder="Route a query — e.g. how many rows in the customers dataset?"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
        />
        <Button onClick={run} disabled={busy} className="shrink-0">
          <TreeStructure className="size-4" />
          {busy ? 'Routing…' : 'Route'}
        </Button>
      </div>

      {result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Routed to
            </span>
            {result.decision.intent.map((k) => (
              <Badge key={k} variant="secondary" className={KIND_STYLE[k]}>
                {k}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">· {result.decision.reason}</span>
          </div>

          {result.hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hits across the routed sources.</p>
          ) : (
            result.hits.map((h) => (
              <div key={h.ref} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={KIND_STYLE[h.sourceKind]}>
                      {h.sourceKind}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">{h.title}</span>
                  </div>
                  <Badge variant="secondary">{h.score}</Badge>
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{h.snippet}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">{h.ref}</p>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

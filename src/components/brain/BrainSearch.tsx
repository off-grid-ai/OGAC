'use client';

import { MagnifyingGlass as Search } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Hit {
  id: string;
  title: string;
  source: string;
  text: string;
  score: number;
}

export function BrainSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/brain/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setHits(data.data as Hit[]);
    } catch {
      toast.error('Search failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={q}
          placeholder="Ask the Brain — e.g. how do I handle a death claim?"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
        />
        <Button onClick={run} disabled={busy} className="shrink-0">
          <Search className="size-4" />
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </div>

      {hits ? (
        <div className="space-y-2">
          {hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matches.</p>
          ) : (
            hits.map((h) => (
              <div key={h.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{h.title}</span>
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    {h.score}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {h.source}
                </p>
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{h.text}</p>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

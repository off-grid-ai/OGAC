'use client';

import { ArrowsClockwise } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

// Qdrant activation: push existing Brain docs' embeddings into the Qdrant collection so switching
// OFFGRID_ADAPTER_RETRIEVAL=qdrant isn't an empty store.
export function ReindexQdrantButton({
  collection,
  qdrantCount,
  sourceDocs,
}: Readonly<{
  collection: string;
  qdrantCount: number | null;
  sourceDocs: number;
}>) {
  const [count, setCount] = useState(qdrantCount);
  const [busy, setBusy] = useState(false);

  async function reindex() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/reindex', { method: 'POST' });
      const json = (await res.json()) as { ok?: boolean; written?: number; qdrantCount?: number; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'reindex failed');
      setCount(json.qdrantCount ?? null);
      toast.success(`Reindexed ${json.written} doc(s) into Qdrant`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-muted-foreground">
        Collection <span className="font-mono text-foreground">{collection}</span> ·{' '}
        {count == null ? 'unreachable' : `${count} indexed`} · {sourceDocs} source doc(s)
      </div>
      <Button size="sm" variant="outline" onClick={() => void reindex()} disabled={busy}>
        {busy ? (
          <Spinner className="mr-1.5 size-4" />
        ) : (
          <ArrowsClockwise className="mr-1.5 size-4" />
        )}
        {busy ? 'Reindexing…' : 'Reindex Brain → Qdrant'}
      </Button>
    </div>
  );
}

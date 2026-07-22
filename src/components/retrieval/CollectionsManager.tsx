'use client';

import { Database, HardDrives, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CollectionSummary } from '@/lib/qdrant-snapshots';

// Vector-store collections list. Each collection is a way IN to its detail page (snapshot / backup
// management). Read-mostly here; the create/delete of the underlying collection is owned by the
// retrieval backend — this surface adds the DISASTER-RECOVERY controls (snapshots) per collection.
const STATUS_CLASS: Record<string, string> = {
  green: 'bg-primary/10 text-primary',
  yellow: 'bg-yellow-500/10 text-yellow-600',
  red: 'bg-destructive/10 text-destructive',
  grey: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

const fmtCount = (n: number | null) => (n === null ? '—' : n.toLocaleString());

export function CollectionsManager({ basePath = '/data/retrieval' }: Readonly<{ basePath?: string }>) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/data/retrieval/collections', { cache: 'no-store' });
      const j = (await res.json()) as {
        configured?: boolean;
        collections?: CollectionSummary[];
        error?: string;
      };
      setConfigured(j.configured !== false);
      setCollections(j.collections ?? []);
      setError(j.error ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Database className="h-5 w-5 text-primary" weight="duotone" />
            Vector collections
          </h1>
          <p className="text-sm text-muted-foreground">
            Backup &amp; disaster-recovery for the retrieval store. Open a collection to manage its
            snapshots.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
          <Link href={basePath}>
            <Button variant="ghost" size="sm">
              Retrieval overview
            </Button>
          </Link>
        </div>
      </div>

      {!configured ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Warning className="h-4 w-4" />
            The vector store isn&apos;t reachable on this deployment
            {error ? <span className="font-mono text-xs">({error})</span> : null}.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {collections.map((c) => (
            <Link key={c.name} href={`${basePath}/collections/${encodeURIComponent(c.name)}`}>
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate font-mono text-sm">{c.name}</CardTitle>
                    <Badge className={STATUS_CLASS[c.status] ?? STATUS_CLASS.unknown}>
                      {c.status}
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-1 text-xs">
                    <HardDrives className="h-3.5 w-3.5" /> {fmtCount(c.pointsCount)} points
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide">Vectors</div>
                    <div className="font-mono tabular-nums text-foreground">
                      {fmtCount(c.vectorsCount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide">Segments</div>
                    <div className="font-mono tabular-nums text-foreground">
                      {fmtCount(c.segmentsCount)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {!loading && collections.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No collections found in the vector store.
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

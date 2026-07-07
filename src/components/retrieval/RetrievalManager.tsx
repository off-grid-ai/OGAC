'use client';

import { Database, Stack, Warning, Plus, Trash, ArrowClockwise, HardDrives, CheckCircle } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CollectionStatus, RetrievalView } from '@/lib/retrieval-view';

const STATUS_CLASS: Record<CollectionStatus, string> = {
  green: 'bg-primary/10 text-primary',
  yellow: 'bg-yellow-500/10 text-yellow-600',
  red: 'bg-destructive/10 text-destructive',
  grey: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

const DISTANCES = ['cosine', 'dot', 'euclid'] as const;

interface Props {
  initialView: RetrievalView;
  initialError: string | null;
}

export function RetrievalManager({ initialView, initialError }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(initialView);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  // Navigational state lives in the URL: ?new=1 opens the create dialog, ?delete=<name>
  // opens the delete confirmation. Back button steps out of a dialog, not off the page.
  const creating = params.get('new') === '1';
  const deleteTarget = params.get('delete');

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      const qs = next.toString();
      router.push(qs ? `/retrieval?${qs}` : '/retrieval', { scroll: false });
    },
    [params, router],
  );

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/admin/retrieval');
      const d = (await r.json()) as { data: RetrievalView | null; error: string | null };
      if (d.data) setView(d.data);
      setError(d.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reload failed');
    }
  }, []);

  // Create form state
  const [name, setName] = useState('');
  const [vectorSize, setVectorSize] = useState('1536');
  const [distance, setDistance] = useState<(typeof DISTANCES)[number]>('cosine');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (creating) {
      setName('');
      setVectorSize('1536');
      setDistance('cosine');
      setFormError(null);
    }
  }, [creating]);

  async function submitCreate() {
    setBusy(true);
    setFormError(null);
    try {
      const r = await fetch('/api/v1/admin/retrieval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, vectorSize, distance }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setFormError(d?.error ?? `HTTP ${r.status}`);
        return;
      }
      setParam('new', null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(target: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/admin/retrieval/${encodeURIComponent(target)}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? `delete failed: HTTP ${r.status}`);
      }
      setParam('delete', null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const manageable = view.isQdrant;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Database className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Retrieval</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Vector store behind the retrieval layer — create, inspect, clear, and delete
              collections on the active adapter. Pushed directly to the backend; never leaves your
              infrastructure.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {view.adapterId}
          </Badge>
          {view.usingEmbeddedStore ? (
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              embedded store · active
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className={view.reachable ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}
            >
              {view.reachable ? 'reachable' : 'unreachable'}
            </Badge>
          )}
          {manageable && (
            <Button size="sm" onClick={() => setParam('new', '1')} disabled={!view.reachable}>
              <Plus className="size-4" /> New collection
            </Button>
          )}
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-3">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Adapter</p>
            <p className="text-sm text-foreground">{view.adapterId}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Endpoint</p>
            <p className="truncate font-mono text-xs text-foreground">{view.url ?? '—'}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Total vectors</p>
            <p className="text-sm text-foreground">{view.totalVectors.toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>

      {view.usingEmbeddedStore ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <HardDrives className="size-5" />
            </div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CheckCircle className="size-4 text-primary" weight="fill" />
              Retrieval is served by the built-in embedded store
              <span className="font-mono">({view.adapterId})</span>
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              This is fully operational — documents indexed through the retrieval layer are stored
              and searched here on your infrastructure. An external vector database (Qdrant) is{' '}
              <span className="font-medium">optional</span>: set{' '}
              <span className="font-mono">OFFGRID_ADAPTER_RETRIEVAL=qdrant</span> and{' '}
              <span className="font-mono">OFFGRID_QDRANT_URL</span> only if you want to manage
              collections from this screen. The embedded store needs no external service.
            </p>
          </CardContent>
        </Card>
      ) : !view.reachable ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Warning className="size-5 text-muted-foreground" />
            <span>
              Vector store unreachable{error ? ` — ${error}` : ''}. Check{' '}
              <span className="font-mono">OFFGRID_QDRANT_URL</span> and that Qdrant is running.
            </span>
            <Button variant="ghost" size="sm" onClick={reload}>
              <ArrowClockwise className="size-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : view.collections.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No collections yet. Create one above, or index documents through the retrieval layer.
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collection</TableHead>
                  <TableHead className="text-right">Vectors</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.collections.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="flex items-center gap-2 font-medium text-foreground">
                      <Stack className="size-3.5 text-muted-foreground" />
                      {c.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.vectorsCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.pointsCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className={STATUS_CLASS[c.status]}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setParam('delete', c.name)}
                      >
                        <Trash className="size-4" /> Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create panel — open/close in the URL (?new=1). */}
      <Sheet open={creating} onOpenChange={(o) => !o && setParam('new', null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New collection</SheetTitle>
            <SheetDescription>
              Creates a Qdrant collection via <span className="font-mono">PUT /collections</span>.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor="col-name">Name</Label>
              <Input
                id="col-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-collection"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="col-size">Vector size</Label>
              <Input
                id="col-size"
                type="number"
                min={1}
                max={65536}
                value={vectorSize}
                onChange={(e) => setVectorSize(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="col-distance">Distance metric</Label>
              <select
                id="col-distance"
                value={distance}
                onChange={(e) => setDistance(e.target.value as (typeof DISTANCES)[number])}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {DISTANCES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setParam('new', null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setParam('delete', null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete collection</DialogTitle>
            <DialogDescription>
              Permanently delete <span className="font-mono">{deleteTarget}</span> and all its
              vectors. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setParam('delete', null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && confirmDelete(deleteTarget)}
              disabled={busy}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

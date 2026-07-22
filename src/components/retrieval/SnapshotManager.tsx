'use client';

import { ArrowClockwise, ArrowLeft, CameraPlus, DownloadSimple, Trash } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type CollectionInfo,
  type SnapshotRow,
  formatSize,
} from '@/lib/qdrant-snapshots';

const STATUS_CLASS: Record<string, string> = {
  green: 'bg-primary/10 text-primary',
  yellow: 'bg-yellow-500/10 text-yellow-600',
  red: 'bg-destructive/10 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
};

const fmtCount = (n: number | null) => (n === null ? '—' : n.toLocaleString());
const fmtTime = (t: string | null) => (t ? t.replace('T', ' ').slice(0, 19) : '—');

interface Props {
  collectionName: string;
  basePath?: string;
}

// Per-collection snapshot / disaster-recovery surface. Full CRUD over snapshots: create (backup),
// download, delete, and restore (recover from a location). Restore is destructive → confirmed dialog.
export function SnapshotManager({ collectionName, basePath = '/data/retrieval' }: Readonly<Props>) {
  const [info, setInfo] = useState<CollectionInfo | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreLocation, setRestoreLocation] = useState('');

  const enc = encodeURIComponent(collectionName);
  const api = `/api/v1/admin/data/retrieval/collections/${enc}`;

  const loadInfo = useCallback(async () => {
    const res = await fetch(api, { cache: 'no-store' });
    const j = (await res.json()) as CollectionInfo & { error?: string };
    if (!res.ok) return setError(j.error ?? `load failed (${res.status})`);
    setInfo(j);
  }, [api]);

  const loadSnapshots = useCallback(async () => {
    const res = await fetch(`${api}/snapshots`, { cache: 'no-store' });
    const j = (await res.json()) as { snapshots?: SnapshotRow[]; error?: string };
    if (!res.ok) return setError(j.error ?? `load failed (${res.status})`);
    setSnapshots(j.snapshots ?? []);
  }, [api]);

  const reload = useCallback(async () => {
    setError(null);
    await Promise.all([loadInfo(), loadSnapshots()]);
  }, [loadInfo, loadSnapshots]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createSnapshot() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${api}/snapshots`, { method: 'POST' });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `create failed (${res.status})`);
      toast.success('Snapshot created');
      await loadSnapshots();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSnapshot(snapshot: string) {
    if (!confirm(`Delete snapshot "${snapshot}"? This backup cannot be recovered.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${api}/snapshots/${encodeURIComponent(snapshot)}`, {
        method: 'DELETE',
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `delete failed (${res.status})`);
      toast.success('Snapshot deleted');
      await loadSnapshots();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (busy || !restoreLocation.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${api}/snapshots/recover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ location: restoreLocation.trim(), priority: 'snapshot' }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `restore failed (${res.status})`);
      toast.success('Collection restored from snapshot');
      setRestoreOpen(false);
      setRestoreLocation('');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stats = [
    { label: 'Status', value: info?.status ?? '—' },
    { label: 'Points', value: fmtCount(info?.pointsCount ?? null) },
    { label: 'Vectors', value: fmtCount(info?.vectorsCount ?? null) },
    { label: 'Indexed', value: fmtCount(info?.indexedVectorsCount ?? null) },
    { label: 'Segments', value: fmtCount(info?.segmentsCount ?? null) },
    { label: 'Dim', value: info?.vectorSize ? String(info.vectorSize) : '—' },
    { label: 'Distance', value: info?.distance ?? '—' },
  ];

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`${basePath}/collections`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Collections
          </Link>
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold">
            {collectionName}
            {info ? (
              <Badge className={STATUS_CLASS[info.status] ?? STATUS_CLASS.unknown}>
                {info.status}
              </Badge>
            ) : null}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy}>
            <ArrowClockwise className="mr-1 h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRestoreOpen(true)} disabled={busy}>
            Restore…
          </Button>
          <Button size="sm" onClick={() => void createSnapshot()} disabled={busy}>
            <CameraPlus className="mr-1 h-4 w-4" /> Create snapshot
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Collection</CardTitle>
          <CardDescription className="text-xs">Live vector-store health &amp; config.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </div>
                <div className="font-mono text-sm tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Snapshots ({snapshots.length})</CardTitle>
          <CardDescription className="text-xs">
            Point-in-time backups. Download to archive off-box, or restore to recover.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="max-w-[24rem] truncate font-mono text-xs">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatSize(s.size)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtTime(s.creationTime)}</TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`${api}/snapshots/${encodeURIComponent(s.name)}`}
                        className="mr-3 inline-flex items-center text-xs text-primary hover:underline"
                      >
                        <DownloadSimple className="mr-1 h-3.5 w-3.5" /> get
                      </a>
                      <button
                        onClick={() => void deleteSnapshot(s.name)}
                        disabled={busy}
                        className="inline-flex items-center text-xs text-destructive hover:underline disabled:opacity-50"
                      >
                        <Trash className="mr-1 h-3.5 w-3.5" /> del
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {snapshots.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      No snapshots yet. Create one to back up this collection.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore from snapshot</DialogTitle>
            <DialogDescription>
              Recover <span className="font-mono">{collectionName}</span> from a snapshot location.
              This is destructive — snapshot data overwrites the live collection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="restore-location">Snapshot location (URL)</Label>
            <Input
              id="restore-location"
              placeholder="http://qdrant:6333/collections/…/snapshots/…  or  file:///qdrant/snapshots/…"
              value={restoreLocation}
              onChange={(e) => setRestoreLocation(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A URL or file path the vector store can read the snapshot from.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void restore()}
              disabled={busy || !restoreLocation.trim()}
            >
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

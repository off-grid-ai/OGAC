'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Data lake object-store management over SeaweedFS's S3 API. Buckets on the left (create/delete),
// the selected bucket's objects on the right (upload/download/delete). URL-driven: `?bucket=` picks
// the bucket so it's deep-linkable + Back-coherent. Governed writes hit the admin lake routes.
interface Bucket { name: string; createdAt: string }
interface ObjectRow { key: string; size: number; lastModified: string }

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1e6 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1e6).toFixed(1)} MB`);

export function DataLakeManager() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const bucket = params.get('bucket') ?? '';
  const [configured, setConfigured] = useState(true);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [objects, setObjects] = useState<ObjectRow[]>([]);
  const [newBucket, setNewBucket] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBuckets = useCallback(async () => {
    const res = await fetch('/api/v1/admin/lake/buckets', { cache: 'no-store' });
    const j = (await res.json()) as { configured?: boolean; buckets?: Bucket[] };
    setConfigured(j.configured !== false);
    setBuckets(j.buckets ?? []);
  }, []);

  const loadObjects = useCallback(async (b: string) => {
    if (!b) return setObjects([]);
    const res = await fetch(`/api/v1/admin/lake/buckets/${encodeURIComponent(b)}/objects`, { cache: 'no-store' });
    const j = (await res.json()) as { objects?: ObjectRow[] };
    setObjects(j.objects ?? []);
  }, []);

  useEffect(() => { void loadBuckets(); }, [loadBuckets]);
  useEffect(() => { void loadObjects(bucket); }, [bucket, loadObjects]);

  const selectBucket = (b: string) => {
    const qs = new URLSearchParams(params.toString());
    qs.set('bucket', b);
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  async function createBucket() {
    if (busy || !newBucket.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/lake/buckets', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: newBucket.trim() }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `create failed (${res.status})`);
      toast.success(`Bucket "${newBucket.trim()}" created`);
      setNewBucket('');
      await loadBuckets();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function upload(files: FileList | null) {
    if (!bucket || !files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const res = await fetch(`/api/v1/admin/lake/buckets/${encodeURIComponent(bucket)}/objects?key=${encodeURIComponent(f.name)}`, {
          method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f,
        });
        if (!res.ok) throw new Error(`${f.name}: upload failed`);
      }
      toast.success('Uploaded');
      await loadObjects(bucket);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function del(key: string) {
    if (!confirm(`Delete ${key}?`)) return;
    const res = await fetch(`/api/v1/admin/lake/buckets/${encodeURIComponent(bucket)}/objects?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Deleted'); await loadObjects(bucket); } else { toast.error('Delete failed'); }
  }

  if (!configured) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          The object store isn&apos;t configured on this deployment yet (no SeaweedFS endpoint).
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="h-fit shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Buckets</CardTitle>
          <CardDescription className="text-xs">Object-store namespaces.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input placeholder="new-bucket-name" value={newBucket} onChange={(e) => setNewBucket(e.target.value)} className="h-9" />
            <Button size="sm" onClick={createBucket} disabled={busy || !newBucket.trim()}>Add</Button>
          </div>
          <div className="divide-y divide-border rounded-md border border-border">
            {buckets.map((b) => (
              <button
                key={b.name}
                onClick={() => selectBucket(b.name)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/40 ${b.name === bucket ? 'bg-muted/60 font-medium' : ''}`}
              >
                {b.name}
                {b.name === bucket ? <Badge variant="secondary">open</Badge> : null}
              </button>
            ))}
            {buckets.length === 0 ? <div className="px-3 py-4 text-center text-xs text-muted-foreground">No buckets yet.</div> : null}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-sm">{bucket ? `Objects · ${bucket}` : 'Objects'}</CardTitle>
            <CardDescription className="text-xs">{bucket ? 'Upload, download, delete.' : 'Select a bucket.'}</CardDescription>
          </div>
          {bucket ? (
            <>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>Upload</Button>
            </>
          ) : null}
        </CardHeader>
        <CardContent>
          {bucket ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Modified</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {objects.map((o) => (
                    <TableRow key={o.key}>
                      <TableCell className="font-medium">{o.key}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBytes(o.size)}</TableCell>
                      <TableCell className="text-muted-foreground">{o.lastModified?.slice(0, 19).replace('T', ' ')}</TableCell>
                      <TableCell className="text-right">
                        <a href={`/api/v1/admin/lake/buckets/${encodeURIComponent(bucket)}/objects?key=${encodeURIComponent(o.key)}&download`} className="mr-2 text-xs text-primary hover:underline">get</a>
                        <button onClick={() => del(o.key)} className="text-xs text-destructive hover:underline">del</button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {objects.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">Empty bucket.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </div>
          ) : <p className="py-6 text-center text-sm text-muted-foreground">Pick a bucket to browse its objects.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

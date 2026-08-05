'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RetentionPanel } from '@/components/lake/RetentionPanel';
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

// The last path segment of a folder prefix, for display: `exports/2026/` → `2026`.
const folderLabel = (p: string, parent: string) => p.slice(parent.length).replace(/\/$/, '');

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1e6 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1e6).toFixed(1)} MB`);

export function DataLakeManager() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const bucket = params.get('bucket') ?? '';
  // The folder position lives in the URL, not in state: descending into a folder is a navigation, so
  // Back must step back OUT of it rather than off the page, and a folder must be shareable.
  const prefix = params.get('prefix') ?? '';
  const [configured, setConfigured] = useState(true);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [objects, setObjects] = useState<ObjectRow[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [newBucket, setNewBucket] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBuckets = useCallback(async () => {
    const res = await fetch('/api/v1/admin/lake/buckets', { cache: 'no-store' });
    const j = (await res.json()) as { configured?: boolean; buckets?: Bucket[] };
    setConfigured(j.configured !== false);
    setBuckets(j.buckets ?? []);
  }, []);

  const loadObjects = useCallback(async (b: string, p: string) => {
    setListError(null);
    if (!b) { setObjects([]); setFolders([]); return; }
    try {
      const res = await fetch(
        `/api/v1/admin/lake/buckets/${encodeURIComponent(b)}/objects?prefix=${encodeURIComponent(p)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`could not list this bucket (${res.status})`);
      const j = (await res.json()) as { objects?: ObjectRow[]; folders?: string[] };
      setObjects(j.objects ?? []);
      setFolders(j.folders ?? []);
    } catch (e) {
      // A failed list is NOT an empty bucket. Showing "Empty bucket." here would tell someone their
      // data is gone.
      setObjects([]); setFolders([]);
      setListError((e as Error).message);
    }
  }, []);

  useEffect(() => { void loadBuckets(); }, [loadBuckets]);
  useEffect(() => { void loadObjects(bucket, prefix); }, [bucket, prefix, loadObjects]);

  const selectBucket = (b: string) => {
    const qs = new URLSearchParams(params.toString());
    qs.set('bucket', b);
    qs.delete('prefix'); // a different bucket starts at its root, not the last bucket's folder
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  // push, not replace: descending into a folder is a step Back should undo.
  const goTo = (p: string) => {
    const qs = new URLSearchParams(params.toString());
    if (p) qs.set('prefix', p); else qs.delete('prefix');
    router.push(`${pathname}?${qs}`, { scroll: false });
  };

  // Every ancestor of the current position, so a reader can jump straight out rather than step.
  const crumbs = prefix
    ? prefix.replace(/\/$/, '').split('/').map((seg, i, all) => ({ seg, path: `${all.slice(0, i + 1).join('/')}/` }))
    : [];

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
        // Upload INTO the folder being viewed — dropping a file while inside exports/ and having it
        // land at the root is a surprise that is only noticed later.
        const res = await fetch(`/api/v1/admin/lake/buckets/${encodeURIComponent(bucket)}/objects?key=${encodeURIComponent(prefix + f.name)}`, {
          method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f,
        });
        if (!res.ok) throw new Error(`${f.name}: upload failed`);
      }
      toast.success('Uploaded');
      await loadObjects(bucket, prefix);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function del(key: string) {
    if (!confirm(`Delete ${key}?`)) return;
    const res = await fetch(`/api/v1/admin/lake/buckets/${encodeURIComponent(bucket)}/objects?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Deleted'); await loadObjects(bucket, prefix); } else { toast.error('Delete failed'); }
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
          <div className="min-w-0">
            <CardTitle className="text-sm">{bucket ? `Objects · ${bucket}` : 'Objects'}</CardTitle>
            <CardDescription className="text-xs">
              {bucket ? (
                crumbs.length ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <button onClick={() => goTo('')} className="text-primary hover:underline">{bucket}</button>
                    {crumbs.map((c, i) => (
                      <span key={c.path} className="flex items-center gap-1">
                        <span className="text-muted-foreground">/</span>
                        {i === crumbs.length - 1 ? (
                          <span className="font-medium">{c.seg}</span>
                        ) : (
                          <button onClick={() => goTo(c.path)} className="text-primary hover:underline">{c.seg}</button>
                        )}
                      </span>
                    ))}
                  </span>
                ) : (
                  'Upload, download, delete.'
                )
              ) : (
                'Select a bucket.'
              )}
            </CardDescription>
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
                  {folders.map((f) => (
                    <TableRow key={f}>
                      <TableCell colSpan={3}>
                        <button onClick={() => goTo(f)} className="font-medium text-primary hover:underline">
                          {folderLabel(f, prefix)}/
                        </button>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">folder</TableCell>
                    </TableRow>
                  ))}
                  {objects.map((o) => (
                    <TableRow key={o.key}>
                      <TableCell className="font-medium">{o.key.slice(prefix.length) || o.key}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBytes(o.size)}</TableCell>
                      <TableCell className="text-muted-foreground">{o.lastModified?.slice(0, 19).replace('T', ' ')}</TableCell>
                      <TableCell className="text-right">
                        <a href={`/api/v1/admin/lake/buckets/${encodeURIComponent(bucket)}/objects?key=${encodeURIComponent(o.key)}&download`} className="mr-2 text-xs text-primary hover:underline">get</a>
                        <button onClick={() => del(o.key)} className="text-xs text-destructive hover:underline">del</button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {objects.length === 0 && folders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                        {listError ? (
                          <span className="text-destructive">
                            {listError} — this is not the same as an empty bucket; what is in here is
                            unknown until this reads successfully.
                          </span>
                        ) : prefix ? (
                          'Nothing in this folder.'
                        ) : (
                          'Empty bucket.'
                        )}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          ) : <p className="py-6 text-center text-sm text-muted-foreground">Pick a bucket to browse its objects.</p>}
        </CardContent>
      </Card>

      {/* Retention sits beside the objects, not on a separate screen: "what is in here" and "how long
          it stays" are one question for whoever has to answer for the data. */}
      {bucket ? <div className="lg:col-span-3"><RetentionPanel bucket={bucket} /></div> : null}
    </div>
  );
}

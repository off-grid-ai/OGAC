'use client';

import {
  ArrowLeft,
  DownloadSimple,
  File,
  Folder,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatBytes } from '@/lib/dataplane-ui';

interface ObjectDomain {
  id: string;
  label: string;
  resource: string;
}

interface ObjectRow {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

interface ObjectDetail extends ObjectRow {
  bucket: string;
  contentType: string;
  metadata: Record<string, string>;
}

interface Listing {
  source: { bucket: string; prefix: string; domainLabel: string };
  prefix: string;
  folders: string[];
  objects: ObjectRow[];
  nextToken: string | null;
}

interface DetailResponse {
  source: { bucket: string; prefix: string; domainLabel: string };
  object: ObjectDetail;
}

const ACCEPTED_FILES = '.csv,.json,.ndjson,.parquet,.pdf,.txt,.md,.png,.jpg,.jpeg,.xlsx,.docx';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function contentTypeFor(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ({
    csv: 'text/csv',
    json: 'application/json',
    ndjson: 'application/x-ndjson',
    parquet: 'application/vnd.apache.parquet',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}

function objectHref(sourceId: string, key: string, domainId: string): string {
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `/data/sources/${encodeURIComponent(sourceId)}/objects/${path}?domain=${encodeURIComponent(domainId)}`;
}

function folderName(prefix: string): string {
  return prefix.replace(/\/$/, '').split('/').at(-1) ?? prefix;
}

export function SourceObjectBrowser({
  source,
  domains,
  objectKey,
}: Readonly<{
  source: { id: string; name: string; endpoint: string };
  domains: ObjectDomain[];
  objectKey?: string;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requestedDomain = params.get('domain') ?? '';
  const activeDomain = requestedDomain
    ? domains.find((domain) => domain.id === requestedDomain) ?? null
    : domains[0] ?? null;
  const prefix = params.get('prefix') ?? '';
  const [listing, setListing] = useState<Listing | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const apiUrl = useCallback(
    (extra?: Record<string, string>) => {
      const query = new URLSearchParams({ domain: activeDomain?.id ?? '' });
      for (const [key, value] of Object.entries(extra ?? {})) query.set(key, value);
      return `/api/v1/admin/connectors/${encodeURIComponent(source.id)}/objects?${query}`;
    },
    [activeDomain?.id, source.id],
  );

  const load = useCallback(async (token?: string) => {
    if (!activeDomain) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        objectKey
          ? apiUrl({ key: objectKey })
          : apiUrl({ ...(prefix ? { prefix } : {}), ...(token ? { token } : {}) }),
        { cache: 'no-store' },
      );
      const body = (await res.json().catch(() => null)) as
        | Listing
        | DetailResponse
        | { error?: string }
        | null;
      if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? 'The source could not be read.');
      if (objectKey) setDetail(body as DetailResponse);
      else {
        const next = body as Listing;
        setListing((current) =>
          token && current
            ? {
                ...next,
                folders: [...current.folders, ...next.folders],
                objects: [...current.objects, ...next.objects],
              }
            : next,
        );
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeDomain, apiUrl, objectKey, prefix]);

  useEffect(() => {
    if (!requestedDomain && activeDomain) {
      const query = new URLSearchParams(params.toString());
      query.set('domain', activeDomain.id);
      router.replace(`${pathname}?${query}`, { scroll: false });
      return;
    }
    void load();
  }, [activeDomain, load, params, pathname, requestedDomain, router]);

  function chooseDomain(domainId: string) {
    const query = new URLSearchParams();
    query.set('domain', domainId);
    router.push(`/data/sources/${encodeURIComponent(source.id)}/objects?${query}`);
  }

  function folderHref(folder: string): string {
    const query = new URLSearchParams({ domain: activeDomain?.id ?? '', prefix: folder });
    return `/data/sources/${encodeURIComponent(source.id)}/objects?${query}`;
  }

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    await uploadFile(file, false);
  }

  async function uploadFile(file: File, replace: boolean) {
    if (!activeDomain || busy) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('Choose a file smaller than 20 MB.');
      return;
    }
    const key = `${prefix ? `${prefix.replace(/\/$/, '')}/` : ''}${file.name}`;
    setBusy(true);
    try {
      const res = await fetch(apiUrl({ key, ...(replace ? { replace: '1' } : {}) }), {
        method: 'POST',
        headers: { 'content-type': contentTypeFor(file) },
        body: file,
      });
      const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (res.status === 409 && body?.code === 'object-exists') {
        setReplaceFile(file);
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? 'Upload failed.');
      toast.success(`${file.name} ${replace ? 'replaced' : 'uploaded'}`);
      setReplaceFile(null);
      await load();
    } catch (cause) {
      toast.error((cause as Error).message);
      if (replace) setReplaceFile(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove() {
    if (!objectKey || busy) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl({ key: objectKey }), { method: 'DELETE' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'Delete failed.');
      toast.success(`${folderName(objectKey)} deleted`);
      const parent = objectKey.split('/').slice(0, -1).join('/');
      const query = new URLSearchParams({ domain: activeDomain?.id ?? '' });
      if (parent) query.set('prefix', parent);
      router.push(`/data/sources/${encodeURIComponent(source.id)}/objects?${query}`);
      router.refresh();
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (domains.length === 0) {
    return (
      <Card>
        <CardContent className="py-10">
          <EmptyState
            title="Approve an object scope first"
            description="Create a data domain for this source and enter its resource as bucket/folder. Only that approved location will become visible here."
          />
        </CardContent>
      </Card>
    );
  }

  if (!activeDomain) {
    return (
      <Card>
        <CardContent className="py-10">
          <ErrorState
            title="This object scope is not approved"
            description="Choose one of this source’s approved locations. No object-store request was made."
            action={
              <Button asChild variant="outline">
                <Link href={`/data/sources/${encodeURIComponent(source.id)}/objects`}>Choose a location</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const parentPrefix = prefix.split('/').filter(Boolean).slice(0, -1).join('/');
  const backPrefix = objectKey?.split('/').slice(0, -1).join('/') ?? '';
  const backQuery = new URLSearchParams({ domain: activeDomain?.id ?? '' });
  if (backPrefix) backQuery.set('prefix', backPrefix);

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2.2fr)]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-sm">Approved locations</CardTitle>
          <CardDescription>Choose the business scope you need. Buckets outside it stay hidden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {domains.map((domain) => (
            <button
              key={domain.id}
              type="button"
              onClick={() => chooseDomain(domain.id)}
              className={`w-full rounded-md border px-3 py-3 text-left transition-colors hover:bg-muted/50 ${
                activeDomain?.id === domain.id ? 'border-primary/50 bg-primary/5' : 'border-border'
              }`}
            >
              <span className="block text-sm font-medium text-foreground">{domain.label}</span>
              <code className="mt-1 block break-all text-xs text-muted-foreground">{domain.resource}</code>
            </button>
          ))}
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Source endpoint</div>
            <code className="mt-1 block break-all">{source.endpoint}</code>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{objectKey ? folderName(objectKey) : activeDomain?.label}</CardTitle>
              <Badge variant="secondary">governed</Badge>
            </div>
            <CardDescription className="mt-1">
              {objectKey
                ? 'Object details and retained source metadata.'
                : listing
                  ? `${listing.source.bucket}/${listing.source.prefix}${prefix}`
                  : 'Loading the approved location.'}
            </CardDescription>
          </div>
          {objectKey ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/data/sources/${encodeURIComponent(source.id)}/objects?${backQuery}`}>
                <ArrowLeft className="size-4" /> Back to objects
              </Link>
            </Button>
          ) : (
            <>
              <input
                ref={fileRef}
                className="hidden"
                type="file"
                accept={ACCEPTED_FILES}
                onChange={(event) => void upload(event.target.files)}
              />
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                <UploadSimple className="size-4" /> {busy ? 'Uploading…' : 'Upload file'}
              </Button>
            </>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3" aria-label="Loading objects">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <ErrorState title="This approved location could not be opened" description={error} />
          ) : objectKey && detail ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Size', formatBytes(detail.object.size)],
                  ['Type', detail.object.contentType || 'Unknown'],
                  ['Modified', detail.object.lastModified?.slice(0, 19).replace('T', ' ') || 'Unknown'],
                  ['ETag', detail.object.etag || 'Not provided'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                    <div className="mt-1 break-all text-sm text-foreground">{value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-border p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Approved path</div>
                <code className="mt-2 block break-all text-sm">{detail.source.bucket}/{detail.source.prefix}{detail.object.key}</code>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a href={apiUrl({ key: objectKey, download: '1' })}>
                    <DownloadSimple className="size-4" /> Download
                  </a>
                </Button>
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash className="size-4" /> Delete object
                </Button>
              </div>
            </div>
          ) : listing ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Link href={folderHref('')} className="hover:text-foreground">Scope root</Link>
                {prefix ? (
                  <>
                    <span>/</span>
                    <Link href={folderHref(parentPrefix)} className="hover:text-foreground">Up one folder</Link>
                  </>
                ) : null}
                <span className="ml-auto">Uploads up to 20 MB</span>
              </div>
              {listing.folders.length === 0 && listing.objects.length === 0 ? (
                <EmptyState
                  title="This approved location is empty"
                  description="Upload a file to make it available to people and agents governed by this data domain."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Modified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listing.folders.map((folder) => (
                      <TableRow key={folder}>
                        <TableCell>
                          <Link className="flex items-center gap-2 font-medium hover:text-primary" href={folderHref(folder)}>
                            <Folder className="size-4 text-primary" /> {folderName(folder)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">Folder</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                      </TableRow>
                    ))}
                    {listing.objects.map((object) => (
                      <TableRow key={object.key}>
                        <TableCell>
                          <Link
                            className="flex items-center gap-2 font-medium hover:text-primary"
                            href={objectHref(source.id, object.key, activeDomain?.id ?? '')}
                          >
                            <File className="size-4 text-muted-foreground" /> {folderName(object.key)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">Object</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBytes(object.size)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {object.lastModified?.slice(0, 19).replace('T', ' ') || 'Unknown'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {listing.nextToken ? (
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">More objects are available in this location.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => void load(listing.nextToken ?? undefined)}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this object?</DialogTitle>
            <DialogDescription>
              {objectKey} will be removed from {activeDomain?.label}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete object'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(replaceFile)} onOpenChange={(open) => !open && setReplaceFile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace the existing object?</DialogTitle>
            <DialogDescription>
              {replaceFile?.name} already exists in this approved location. Replacing it overwrites
              the current contents while keeping the same object path.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplaceFile(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => replaceFile && void uploadFile(replaceFile, true)} disabled={busy}>
              {busy ? 'Replacing…' : 'Replace object'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

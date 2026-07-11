'use client';

import {
  ArrowSquareOut,
  Copy,
  Eye,
  EyeSlash,
  File,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FilePdf,
  Folder,
  CaretLeft,
  CaretRight,
  ShareNetwork,
  Sliders,
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/ui/Pagination';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { usePagination } from '@/lib/use-pagination';

interface FileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  visibility: 'public' | 'private';
  owner: string;
  createdAt: string;
  url: string;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function FileIcon({ mime, className }: Readonly<{ mime: string; className?: string }>) {
  if (mime.startsWith('image/')) return <FileImage className={className} />;
  if (mime.startsWith('video/')) return <FileVideo className={className} />;
  if (mime.startsWith('audio/')) return <FileAudio className={className} />;
  if (mime === 'application/pdf') return <FilePdf className={className} />;
  if (mime.includes('javascript') || mime.includes('json') || mime.includes('html') || mime.includes('css') || mime.includes('typescript'))
    return <FileCode className={className} />;
  return <File className={className} />;
}

function FileCard({
  file,
  onDelete,
  onToggleVisibility,
  onShare,
}: Readonly<{
  file: FileMeta;
  onDelete: (id: string) => void;
  onToggleVisibility: (id: string, current: 'public' | 'private') => void;
  onShare: (file: FileMeta) => void;
}>) {
  const isImage = file.mime.startsWith('image/');
  const isVideo = file.mime.startsWith('video/');
  const [failed, setFailed] = useState(false);

  return (
    <Card className="group relative shadow-sm transition-shadow hover:shadow-md">
      {/* Thumbnail: render the real media from the gateway (SeaweedFS) so it previews inline. */}
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-t-lg border-b border-border bg-muted/30"
      >
        {isImage && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={file.name} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        ) : isVideo && !failed ? (
          <video src={file.url} muted playsInline preload="metadata" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        ) : (
          <FileIcon mime={file.mime} className="size-12 text-muted-foreground/50" />
        )}
      </a>

      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground" title={file.name}>
            {file.name}
          </p>
          <Badge
            variant="secondary"
            className={
              file.visibility === 'public'
                ? 'shrink-0 bg-primary/10 text-primary'
                : 'shrink-0 bg-muted text-muted-foreground'
            }
          >
            {file.visibility}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span>{formatBytes(file.size)}</span>
          <span>·</span>
          <span className="truncate">{file.mime.split('/')[1] ?? file.mime}</span>
        </div>

        <p className="font-mono text-[10px] text-muted-foreground">
          {new Date(file.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-1 pt-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Copy URL"
            onClick={() => {
              void navigator.clipboard.writeText(file.url);
              toast.success('URL copied.');
            }}
          >
            <Copy className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Open in new tab"
            onClick={() => window.open(file.url, '_blank')}
          >
            <ArrowSquareOut className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Share (expiring link)"
            onClick={() => onShare(file)}
          >
            <ShareNetwork className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={file.visibility === 'public' ? 'Make private' : 'Make public'}
            onClick={() => onToggleVisibility(file.id, file.visibility)}
          >
            {file.visibility === 'public' ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            title="Delete"
            onClick={() => onDelete(file.id)}
          >
            <Trash className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Drag-and-drop upload zone
function UploadZone({ onUploaded }: Readonly<{ onUploaded: () => void }>) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      let ok = 0;
      for (const f of Array.from(files)) {
        try {
          const form = new FormData();
          form.append('file', f);
          const res = await fetch('/api/v1/files?visibility=private', { method: 'POST', body: form });
          if (res.ok) ok++;
          else {
            const d = (await res.json()) as { error?: string };
            toast.error(`${f.name}: ${d.error ?? 'upload failed'}`);
          }
        } catch {
          toast.error(`${f.name}: network error`);
        }
      }
      setUploading(false);
      if (ok > 0) {
        toast.success(`${ok} file${ok > 1 ? 's' : ''} uploaded.`);
        onUploaded();
      }
    },
    [onUploaded],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload files — click or drop files here"
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40'
      }`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
    >
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
      <UploadSimple className={`size-8 ${dragging ? 'text-primary' : 'text-muted-foreground'}`} />
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">
          {uploading ? 'Uploading…' : 'Drop files here or click to upload'}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">Any file type · stored on-prem · private by default</p>
      </div>
    </div>
  );
}

// Filter bar
type Filter = 'all' | 'images' | 'videos' | 'documents' | 'public' | 'private';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'documents', label: 'Documents' },
  { id: 'public', label: 'Public' },
  { id: 'private', label: 'Private' },
];

// The bucket is one namespace; the full key prefix (everything but the filename) is the folder,
// so each PR/run gets its own group — e.g. provit/pr25-frames/frame-0063.png → "provit/pr25-frames".
// Flat uploads with no prefix group under "media".
function folderOf(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash === -1 ? 'media' : id.slice(0, slash);
}
function groupByFolder(files: FileMeta[]): [string, FileMeta[]][] {
  const map = new Map<string, FileMeta[]>();
  for (const f of files) {
    const k = folderOf(f.id);
    (map.get(k) ?? map.set(k, []).get(k)!).push(f);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function applyFilter(files: FileMeta[], filter: Filter): FileMeta[] {
  switch (filter) {
    case 'images': return files.filter((f) => f.mime.startsWith('image/'));
    case 'videos': return files.filter((f) => f.mime.startsWith('video/'));
    case 'documents': return files.filter((f) => !f.mime.startsWith('image/') && !f.mime.startsWith('video/') && !f.mime.startsWith('audio/'));
    case 'public': return files.filter((f) => f.visibility === 'public');
    case 'private': return files.filter((f) => f.visibility === 'private');
    default: return files;
  }
}

// First-level navigation: a compact folder tile (icon + name + file count) — no preview, so it
// stays a fixed small size. Clicking opens the folder to reveal its files. Top level = folders only.
function FolderCard({ name, files, onOpen }: Readonly<{ name: string; files: FileMeta[]; onOpen: () => void }>) {
  const label = name.split('/').pop() || name;
  return (
    <Card className="cursor-pointer shadow-sm transition-shadow hover:shadow-md" onClick={onOpen}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Folder className="size-5" weight="fill" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm text-foreground" title={name}>{label}</p>
          <p className="font-mono text-xs text-muted-foreground">{files.length} file{files.length !== 1 ? 's' : ''}</p>
        </div>
        <CaretRight className="size-4 shrink-0 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

// ── Share dialog: pick a TTL, mint an expiring signed link, copy it. ────────────────────────────
const TTL_CHOICES: { label: string; seconds: number }[] = [
  { label: '15 min', seconds: 900 },
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
];

function ShareDialog({ file, onClose }: Readonly<{ file: FileMeta | null; onClose: () => void }>) {
  const [ttl, setTtl] = useState(3600);
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ url: string; signed: boolean; expiresAt: string | null } | null>(null);

  // Reset when a different file opens.
  useEffect(() => {
    setLink(null);
    setTtl(3600);
  }, [file?.id]);

  const mint = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/files/share/${file.id}?ttl=${ttl}`, { method: 'POST' });
      if (!res.ok) {
        toast.error('Could not create share link.');
        return;
      }
      const data = (await res.json()) as { url: string; signed: boolean; expiresAt: string | null };
      setLink(data);
      await navigator.clipboard.writeText(data.url).catch(() => {});
      toast.success(data.signed ? 'Expiring link copied.' : 'Link copied (see note).');
    } catch {
      toast.error('Network error.');
    } finally {
      setLoading(false);
    }
  }, [file, ttl]);

  // Share-link button label: minting, regenerating an existing link, or creating the first one.
  let shareLinkLabel: string;
  if (loading) shareLinkLabel = 'Generating…';
  else shareLinkLabel = link ? 'Regenerate' : 'Create link';

  return (
    <FormSheet
      open={!!file}
      onOpenChange={(o) => !o && onClose()}
      title={`Share ${file?.name ?? ''}`}
      description="Generate a time-limited link that grants read access, then expires — no login required to open it."
      size="md"
      footer={
        <Button onClick={() => void mint()} disabled={loading} className="w-full gap-1.5">
          {loading ? <Spinner /> : null}
          {shareLinkLabel}
        </Button>
      }
    >
      <div className="space-y-3">
          <Label className="text-xs">Link expires after</Label>
          <div className="flex flex-wrap gap-1.5">
            {TTL_CHOICES.map((c) => (
              <button
                key={c.seconds}
                onClick={() => setTtl(c.seconds)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  ttl === c.seconds ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {link && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Input readOnly value={link.url} className="font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  title="Copy"
                  onClick={() => {
                    void navigator.clipboard.writeText(link.url);
                    toast.success('Copied.');
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              {link.signed ? (
                <p className="font-mono text-[10px] text-muted-foreground">
                  Expires {link.expiresAt ? new Date(link.expiresAt).toLocaleString() : ''}
                </p>
              ) : (
                <p className="font-mono text-[10px] text-amber-600 dark:text-amber-500">
                  Note: SeaweedFS has no IAM keypair provisioned, so this link cannot expire — it is the
                  plain object URL. Provision S3 credentials to get true time-limited links.
                </p>
              )}
            </div>
          )}
        </div>
    </FormSheet>
  );
}

// ── Bucket settings panel: object-expiry lifecycle rules + public/private policy. URL-driven via
// ?panel=bucket so it's a real place on the history stack (Back closes it). Admin-only server-side.
interface LifecycleRuleUI {
  id: string;
  prefix: string;
  expireDays: number;
  enabled: boolean;
}
interface BucketState {
  lifecycle: { supported: boolean; rules: LifecycleRuleUI[]; note?: string };
  policy: { supported: boolean; access: 'public' | 'private'; note?: string };
}

function BucketPanel({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const [state, setState] = useState<BucketState | null>(null);
  const [rules, setRules] = useState<LifecycleRuleUI[]>([]);
  const [access, setAccess] = useState<'public' | 'private'>('private');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/storage/bucket');
      if (res.status === 403) {
        toast.error('Bucket settings are admin-only.');
        onClose();
        return;
      }
      const data = (await res.json()) as BucketState;
      setState(data);
      setRules(data.lifecycle.rules ?? []);
      setAccess(data.policy.access);
    } catch {
      toast.error('Failed to load bucket settings.');
    } finally {
      setLoading(false);
    }
  }, [onClose]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const addRule = () =>
    setRules((r) => [...r, { id: `expire-${r.length + 1}`, prefix: '', expireDays: 30, enabled: true }]);
  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));
  const patchRule = (i: number, patch: Partial<LifecycleRuleUI>) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, ...patch } : rule)));

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/storage/bucket', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules, access }),
      });
      if (!res.ok) {
        toast.error('Save failed.');
        return;
      }
      const data = (await res.json()) as Partial<BucketState>;
      const lc = data.lifecycle;
      const pol = data.policy;
      if (lc && !lc.supported) toast.warning(`Lifecycle not applied: ${lc.note ?? 'unsupported by SeaweedFS'}`);
      if (pol && !pol.supported) toast.warning(`Policy not applied: ${pol.note ?? 'unsupported by SeaweedFS'}`);
      if ((!lc || lc.supported) && (!pol || pol.supported)) toast.success('Bucket settings saved.');
      await load();
    } catch {
      toast.error('Network error.');
    } finally {
      setSaving(false);
    }
  }, [rules, access, load]);

  return (
    <FormSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title="Bucket settings"
      description="Object-expiry lifecycle rules and the bucket's public/private access policy."
      footer={
        <Button onClick={() => void save()} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      }
    >
      {loading ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-6">
            {/* Access policy */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Bucket access</Label>
                  <p className="text-xs text-muted-foreground">Public grants anonymous read to every object in the bucket.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{access}</span>
                  <Switch
                    checked={access === 'public'}
                    onCheckedChange={(c) => setAccess(c ? 'public' : 'private')}
                    disabled={state ? !state.policy.supported : false}
                  />
                </div>
              </div>
              {state && !state.policy.supported && (
                <p className="font-mono text-[10px] text-amber-600 dark:text-amber-500">
                  Bucket policy unsupported here: {state.policy.note ?? 'SeaweedFS S3 rejected the call'}
                </p>
              )}
            </section>

            {/* Lifecycle rules */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Expiry rules</Label>
                <Button size="sm" variant="outline" onClick={addRule} disabled={state ? !state.lifecycle.supported : false}>
                  Add rule
                </Button>
              </div>
              {state && !state.lifecycle.supported && (
                <p className="font-mono text-[10px] text-amber-600 dark:text-amber-500">
                  Lifecycle unsupported here: {state.lifecycle.note ?? 'SeaweedFS S3 rejected the call'}
                </p>
              )}
              {rules.length === 0 ? (
                <p className="text-xs text-muted-foreground">No expiry rules — objects are kept indefinitely.</p>
              ) : (
                <div className="space-y-2">
                  {rules.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                      <Input
                        value={r.prefix}
                        placeholder="prefix (blank = all)"
                        className="h-8 flex-1 font-mono text-xs"
                        onChange={(e) => patchRule(i, { prefix: e.target.value })}
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          value={r.expireDays}
                          className="h-8 w-16 font-mono text-xs"
                          onChange={(e) => patchRule(i, { expireDays: Number(e.target.value) })}
                        />
                        <span className="font-mono text-xs text-muted-foreground">days</span>
                      </div>
                      <Switch checked={r.enabled} onCheckedChange={(c) => patchRule(i, { enabled: c })} />
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Remove" onClick={() => removeRule(i)}>
                        <Trash className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
        </div>
      )}
    </FormSheet>
  );
}

export function StorageBrowser() {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  // Folder navigation is URL-driven (?folder=…) so it pushes to the history stack — the browser
  // Back button steps out of a folder coherently instead of leaving the page. See CLAUDE.md:
  // every screen/navigation change must be reflected in the nav stack.
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const openFolder = search.get('folder');
  const setOpenFolder = useCallback(
    (folder: string | null) => {
      router.push(folder ? `${pathname}?folder=${encodeURIComponent(folder)}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // Bucket-settings panel is a URL place (?panel=bucket) so Back closes it — see CLAUDE.md.
  const panelOpen = search.get('panel') === 'bucket';
  const setPanelOpen = useCallback(
    (openIt: boolean) => {
      const q = new URLSearchParams(search.toString());
      if (openIt) q.set('panel', 'bucket');
      else q.delete('panel');
      const qs = q.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  // Share panel is a URL place (?share=<fileId>) so it's deep-linkable and Back closes it — the
  // panel holds state (chosen TTL, the minted link), so it's a "place", not a transient popup.
  const shareId = search.get('share');
  const setShareId = useCallback(
    (id: string | null) => {
      const q = new URLSearchParams(search.toString());
      if (id) q.set('share', id);
      else q.delete('share');
      const qs = q.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/files');
      const data = (await res.json()) as { files?: FileMeta[] };
      setFiles(data.files ?? []);
    } catch {
      toast.error('Failed to load files.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchFiles(); }, [fetchFiles]);

  const deleteFile = async (id: string) => {
    if (!window.confirm('Delete this file? This cannot be undone.')) return;
    const res = await fetch(`/api/v1/files/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      toast.success('File deleted.');
    } else {
      toast.error('Delete failed.');
    }
  };

  const toggleVisibility = async (id: string, current: 'public' | 'private') => {
    const next = current === 'public' ? 'private' : 'public';
    const res = await fetch(`/api/v1/files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: next }),
    });
    if (res.ok) {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, visibility: next } : f)));
      toast.success(`File is now ${next}.`);
    } else {
      toast.error('Failed to update visibility.');
    }
  };

  const visible = applyFilter(files, filter);
  const folders = groupByFolder(visible);
  const current = openFolder ? folders.find(([f]) => f === openFolder) : null;

  // Both the folder tiles and a folder's file list can run large — object stores are unbounded.
  // Paginate each grid client-side. Two hooks, distinct URL keys, so the folder page and the
  // in-folder file page are independent, deep-linkable positions (only one grid renders at a time).
  const folderPage = usePagination(folders, { key: 'folder', defaultPageSize: 24 });
  const filePage = usePagination(current ? current[1] : [], { key: 'file', defaultPageSize: 24 });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setPanelOpen(true)}>
          <Sliders className="mr-1.5 size-3.5" />
          Bucket settings
        </Button>
      </div>

      <UploadZone onUploaded={fetchFiles} />

      <ShareDialog file={files.find((f) => f.id === shareId) ?? null} onClose={() => setShareId(null)} />
      <BucketPanel open={panelOpen} onClose={() => setPanelOpen(false)} />

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground sm:gap-x-6">
        <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
        <span>{files.filter((f) => f.visibility === 'public').length} public</span>
        <span>{formatBytes(files.reduce((s, f) => s + f.size, 0))} total</span>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {f.label}
            {f.id !== 'all' && (
              <span className="ml-1.5 opacity-60">{applyFilter(files, f.id).length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Grid: top level shows FOLDERS only; opening one reveals its files. */}
      {loading ? (
        <LoadingBlock />
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16">
          <X className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {files.length === 0 ? 'No files yet — upload something above.' : 'No files match this filter.'}
          </p>
        </div>
      ) : openFolder && current ? (
        // Inside a folder: breadcrumb back + this folder's files.
        <div className="space-y-3">
          <button
            onClick={() => setOpenFolder(null)}
            className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <CaretLeft className="size-3.5" />
            All folders
          </button>
          <div className="flex items-center gap-2">
            <Folder className="size-4 text-primary" weight="fill" />
            <h3 className="font-mono text-sm font-medium text-foreground">{openFolder}</h3>
            <span className="font-mono text-xs text-muted-foreground">{current[1].length}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filePage.pageItems.map((f) => (
              <FileCard key={f.id} file={f} onDelete={deleteFile} onToggleVisibility={toggleVisibility} onShare={(file) => setShareId(file.id)} />
            ))}
          </div>
          <Pagination
            state={filePage}
            onPageChange={filePage.setPage}
            onPageSizeChange={filePage.setPageSize}
            pageSizeOptions={[12, 24, 48, 96]}
            itemLabel="files"
          />
        </div>
      ) : (
        // Top level: folders only.
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {folderPage.pageItems.map(([folder, group]) => (
              <FolderCard key={folder} name={folder} files={group} onOpen={() => setOpenFolder(folder)} />
            ))}
          </div>
          <Pagination
            state={folderPage}
            onPageChange={folderPage.setPage}
            onPageSizeChange={folderPage.setPageSize}
            pageSizeOptions={[12, 24, 48, 96]}
            itemLabel="folders"
          />
        </div>
      )}
    </div>
  );
}

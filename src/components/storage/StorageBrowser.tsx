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
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

function FileIcon({ mime, className }: { mime: string; className?: string }) {
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
}: {
  file: FileMeta;
  onDelete: (id: string) => void;
  onToggleVisibility: (id: string, current: 'public' | 'private') => void;
}) {
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
function UploadZone({ onUploaded }: { onUploaded: () => void }) {
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
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40'
      }`}
      onClick={() => inputRef.current?.click()}
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

// First-level navigation: a folder tile (name + count + a preview of the first image/video in
// it). Clicking opens the folder to reveal its files. Keeps the top level to folders only.
function FolderCard({ name, files, onOpen }: { name: string; files: FileMeta[]; onOpen: () => void }) {
  const preview = files.find((f) => f.mime.startsWith('image/')) ?? files.find((f) => f.mime.startsWith('video/'));
  const [failed, setFailed] = useState(false);
  const label = name.split('/').pop() || name;
  return (
    <Card className="group cursor-pointer shadow-sm transition-shadow hover:shadow-md" onClick={onOpen}>
      <div className="flex h-32 items-center justify-center overflow-hidden rounded-t-lg border-b border-border bg-muted/30">
        {preview && !failed ? (
          preview.mime.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.url} alt={label} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
          ) : (
            <video src={preview.url} muted playsInline preload="metadata" onError={() => setFailed(true)} className="h-full w-full object-cover" />
          )
        ) : (
          <Folder className="size-10 text-muted-foreground/50" weight="fill" />
        )}
      </div>
      <CardContent className="flex items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Folder className="size-4 shrink-0 text-primary" />
          <p className="truncate font-mono text-sm text-foreground" title={name}>{label}</p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{files.length}</span>
      </CardContent>
    </Card>
  );
}

export function StorageBrowser() {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [openFolder, setOpenFolder] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <UploadZone onUploaded={fetchFiles} />

      {/* Stats row */}
      <div className="flex items-center gap-6 font-mono text-xs text-muted-foreground">
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
        <p className="py-12 text-center text-xs text-muted-foreground">Loading…</p>
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
            {current[1].map((f) => (
              <FileCard key={f.id} file={f} onDelete={deleteFile} onToggleVisibility={toggleVisibility} />
            ))}
          </div>
        </div>
      ) : (
        // Top level: folders only.
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {folders.map(([folder, group]) => (
            <FolderCard key={folder} name={folder} files={group} onOpen={() => setOpenFolder(folder)} />
          ))}
        </div>
      )}
    </div>
  );
}

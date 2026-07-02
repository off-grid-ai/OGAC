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
  const [preview, setPreview] = useState(false);

  return (
    <Card className="group relative shadow-sm transition-shadow hover:shadow-md">
      {/* Thumbnail or icon */}
      <div
        className="flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-t-lg border-b border-border bg-muted/30"
        onClick={() => setPreview((p) => !p)}
      >
        {isImage && preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/v1/files/${file.id}`} alt={file.name} className="h-full w-full object-contain" />
        ) : (
          <FileIcon mime={file.mime} className="size-12 text-muted-foreground/50" />
        )}
        {isImage && !preview && (
          <span className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            preview
          </span>
        )}
      </div>

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
            onClick={() => window.open(`/api/v1/files/${file.id}`, '_blank')}
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

export function StorageBrowser() {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

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

      {/* Grid */}
      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16">
          <X className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {files.length === 0 ? 'No files yet — upload something above.' : 'No files match this filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((f) => (
            <FileCard key={f.id} file={f} onDelete={deleteFile} onToggleVisibility={toggleVisibility} />
          ))}
        </div>
      )}
    </div>
  );
}

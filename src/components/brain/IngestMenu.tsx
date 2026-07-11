'use client';

import {
  CaretDown,
  Database,
  FileText,
  Image as ImageIcon,
  TextT,
} from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { IngestKind } from '@/lib/ingest';

type Dataset = { id: string; name: string };
type Ingest = (body: Record<string, unknown>) => Promise<void>;

const TITLES: Record<IngestKind, string> = {
  text: 'Ingest text',
  file: 'Ingest a file',
  image: 'Ingest an image',
  database: 'Ingest from a dataset',
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function TextPanel({ ingest, busy }: Readonly<{ ingest: Ingest; busy: boolean }>) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  return (
    <div className="space-y-3">
      <Label htmlFor="t-title">Title</Label>
      <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Label htmlFor="t-text">Content</Label>
      <Textarea id="t-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <Button
        onClick={() => ingest({ kind: 'text', title, text, source: 'Text' })}
        disabled={busy || !title || !text}
        className="w-full"
      >
        {busy ? 'Indexing…' : 'Index'}
      </Button>
    </div>
  );
}

function FilePanel({ ingest, busy }: Readonly<{ ingest: Ingest; busy: boolean }>) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  async function pick(file: File | undefined) {
    if (!file) return;
    setName(file.name);
    setText(await file.text());
  }
  return (
    <div className="space-y-3">
      <Label htmlFor="f-file">Text or Markdown file</Label>
      <Input
        id="f-file"
        type="file"
        accept=".txt,.md,.csv,.json,.log"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {name ? (
        <p className="text-xs text-muted-foreground">
          {name} · {text.length} chars
        </p>
      ) : null}
      <Button
        onClick={() => ingest({ kind: 'file', name, text })}
        disabled={busy || !text}
        className="w-full"
      >
        {busy ? 'Indexing…' : 'Index file'}
      </Button>
    </div>
  );
}

function ImagePanel({ ingest, busy }: Readonly<{ ingest: Ingest; busy: boolean }>) {
  const [title, setTitle] = useState('');
  const [dataUrl, setDataUrl] = useState('');
  async function pick(file: File | undefined) {
    if (!file) return;
    setTitle(file.name);
    setDataUrl(await readAsDataUrl(file));
  }
  return (
    <div className="space-y-3">
      <Label htmlFor="i-file">Image (captioned by the gateway)</Label>
      <Input id="i-file" type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
      {dataUrl ? <p className="text-xs text-muted-foreground">{title} · ready</p> : null}
      <Button
        onClick={() => ingest({ kind: 'image', title, dataUrl })}
        disabled={busy || !dataUrl}
        className="w-full"
      >
        {busy ? 'Captioning & indexing…' : 'Caption & index'}
      </Button>
    </div>
  );
}

function DatabasePanel({
  ingest,
  busy,
  datasets,
}: Readonly<{
  ingest: Ingest;
  busy: boolean;
  datasets: Dataset[];
}>) {
  if (datasets.length === 0) {
    return <p className="text-sm text-muted-foreground">No datasets in the data plane.</p>;
  }
  return (
    <div className="space-y-2">
      {datasets.map((d) => (
        <Button
          key={d.id}
          variant="outline"
          disabled={busy}
          className="w-full justify-start"
          onClick={() => ingest({ kind: 'database', datasetId: d.id })}
        >
          <Database className="size-4" /> {d.name}
        </Button>
      ))}
    </div>
  );
}

function Panel(props: { kind: IngestKind; ingest: Ingest; busy: boolean; datasets: Dataset[] }) {
  const { kind, ingest, busy, datasets } = props;
  if (kind === 'text') return <TextPanel ingest={ingest} busy={busy} />;
  if (kind === 'file') return <FilePanel ingest={ingest} busy={busy} />;
  if (kind === 'image') return <ImagePanel ingest={ingest} busy={busy} />;
  return <DatabasePanel ingest={ingest} busy={busy} datasets={datasets} />;
}

const MENU: { kind: IngestKind; label: string; icon: typeof TextT }[] = [
  { kind: 'text', label: 'Text', icon: TextT },
  { kind: 'file', label: 'File', icon: FileText },
  { kind: 'image', label: 'Image', icon: ImageIcon },
  { kind: 'database', label: 'From dataset', icon: Database },
];

const KINDS = new Set<IngestKind>(['text', 'file', 'image', 'database']);

export function IngestMenu({ datasets }: Readonly<{ datasets: Dataset[] }>) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);

  // Which ingest form is open lives in the URL (?panel=ingest&kind=<kind>) — Back closes it.
  const raw = params.get('panel') === 'ingest' ? params.get('kind') : null;
  const kind: IngestKind | null = raw && KINDS.has(raw as IngestKind) ? (raw as IngestKind) : null;

  const setKind = useCallback(
    (next: IngestKind | null) => {
      const p = new URLSearchParams(params.toString());
      if (next) {
        p.set('panel', 'ingest');
        p.set('kind', next);
      } else {
        p.delete('panel');
        p.delete('kind');
      }
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  async function ingest(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/brain/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('failed');
      toast.success('Ingested into the Brain');
      setKind(null);
      router.refresh();
    } catch {
      toast.error('Ingestion failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm">
            Ingest
            <CaretDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {MENU.map((m) => (
            <DropdownMenuItem key={m.kind} onClick={() => setKind(m.kind)}>
              <m.icon className="size-4" /> {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet open={kind !== null} onOpenChange={(o) => !o && setKind(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{kind ? TITLES[kind] : ''}</SheetTitle>
            <SheetDescription>Extracted, embedded, and indexed with provenance.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {kind ? <Panel kind={kind} ingest={ingest} busy={busy} datasets={datasets} /> : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

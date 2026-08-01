'use client';

import { ArrowSquareOut, FileText, NotePencil, Trash, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { explainResponse } from '@/lib/api-failure';
import { SUPPORTED_UPLOAD_ACCEPT } from '@/lib/upload-formats';
import { KnowledgeTextSheet } from '@/components/knowledge/KnowledgeTextSheet';
import { postKnowledgeDocument, postKnowledgeFile } from '@/lib/knowledge-intake';

interface Doc {
  id: string;
  name: string;
  size: number;
  kind: string;
  createdAt: string;
}

interface Preview {
  name: string;
  chunks: { position: number; content: string }[];
  fileUrl?: string | null;
  error?: string;
}

// The documents sub-resource for a single collection's DETAIL page: index a document (a file OR pasted
// text), READ one, and remove existing ones.
//
// The INTAKE controls are shown to everyone who can see the collection, and a caller who may not write
// gets the server's own refusal ("read-only demo: this account can view everything but cannot make
// changes"). Hiding them made the capability invisible: a viewer walking the console — which is how this
// product is demonstrated — had no way to know the collection accepts pasted text at all, and a buyer
// asking "can I add a document here?" got no answer from the screen. DELETE stays admin-only, because a
// destructive control offered to someone who cannot use it is a different and worse thing.
// Reading a document is not an admin action either — that is how a citation gets checked.
export function CollectionDocuments({
  collectionId,
  collectionName = 'this collection',
  documents,
  isAdmin,
}: Readonly<{
  collectionId: string;
  collectionName?: string;
  documents: Doc[];
  isAdmin: boolean;
}>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // One index path for both intake modes — a file's text and pasted text are the same thing to the
  // indexer, so a fix to either lands once.
  async function index(name: string, content: string) {
    setBusy(true);
    const result = await postKnowledgeDocument(collectionId, name, content);
    setBusy(false);
    if (!result.ok) {
      // A refusal is the system working (curated collections are admin-only), so it must not be
      // phrased as breakage — and the server's own reason beats anything invented here.
      (result.failure.refusal ? toast.info : toast.error)(result.failure.message);
      return false;
    }
    toast.success(`Indexed "${name}" (${result.chunks} chunks)`);
    router.refresh();
    return true;
  }

  async function upload(file: File) {
    // Multipart, so the SERVER extracts the text (pdfjs for PDFs). Reading it here with file.text()
    // is what indexed a PDF's container bytes as prose.
    setBusy(true);
    const result = await postKnowledgeFile(collectionId, file);
    setBusy(false);
    if (result.ok) {
      toast.success(`Indexed "${file.name}" (${result.chunks} chunks)`);
      router.refresh();
    } else {
      (result.failure.refusal ? toast.info : toast.error)(result.failure.message);
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  // The composer is the shared side panel — the same one the project knowledge panel uses.
  async function saveNote(docName: string, body: string): Promise<boolean> {
    return index(docName, body);
  }

  async function open(doc: Doc) {
    setPreview({ name: doc.name, chunks: [] });
    try {
      const res = await fetch(`/api/v1/knowledge/documents/${doc.id}`);
      if (!res.ok) {
        const failure = await explainResponse(res, `open "${doc.name}"`);
        setPreview({ name: doc.name, chunks: [], error: failure.message });
        return;
      }
      const { document } = (await res.json()) as {
        document: { chunks: { position: number; content: string }[]; fileUrl: string | null };
      };
      setPreview({ name: doc.name, chunks: document.chunks ?? [], fileUrl: document.fileUrl });
    } catch {
      setPreview({ name: doc.name, chunks: [], error: 'Could not reach the server.' });
    }
  }

  async function remove(id: string, name: string) {
    const res = await fetch(`/api/v1/knowledge/documents/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const failure = await explainResponse(res, `remove "${name}"`);
      (failure.refusal ? toast.info : toast.error)(failure.message);
      return;
    }
    toast.success(`Removed "${name}"`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={SUPPORTED_UPLOAD_ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="gap-1.5"
              onClick={() => fileRef.current?.click()}
            >
              <UploadSimple className="size-4" /> {busy ? 'Indexing…' : 'Add file'}
            </Button>
            {/* Knowledge is not only files. A clause pasted out of an email is a source too, and
                making someone save a .txt first is friction for the operator this page is for. */}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="gap-1.5"
              onClick={() => setNoteOpen(true)}
            >
              <NotePencil className="size-4" /> Add text
            </Button>
          </div>
        </div>
      }

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents indexed yet.</p>
      ) : (
        <div className="space-y-1">
          {documents.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              {/* Clickable: this page claims these documents ground the org's answers, so the source
                  behind a citation must be readable. Opens the indexed chunks — what retrieval sees. */}
              <button
                type="button"
                onClick={() => void open(d)}
                className="min-w-0 flex-1 text-left"
                title={`Preview ${d.name}`}
              >
                <div className="truncate font-medium text-foreground underline decoration-border decoration-dotted underline-offset-2 hover:decoration-primary">
                  {d.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {d.kind} · {(d.size / 1024).toFixed(1)} KB · {d.createdAt.slice(0, 10)}
                </div>
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  aria-label={`Remove ${d.name}`}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(d.id, d.name)}
                >
                  <Trash className="size-4" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <KnowledgeTextSheet
        open={noteOpen}
        onOpenChange={setNoteOpen}
        target={collectionName}
        busy={busy}
        onSave={saveNote}
      />

      <Sheet open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <SheetContent side="right" className="flex w-full max-w-2xl flex-col gap-0 p-0">
          <SheetHeader className="gap-1 border-b border-border px-4 py-3 pr-10">
            <SheetTitle className="font-mono text-sm">{preview?.name ?? 'Document'}</SheetTitle>
            <p className="text-xs text-muted-foreground">
              The indexed text this collection retrieves and cites.
            </p>
          </SheetHeader>
          <SheetBody className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {preview?.fileUrl ? (
              <a
                href={preview.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary underline"
              >
                <ArrowSquareOut className="size-3.5" /> Open the original file
              </a>
            ) : null}
            {preview?.error ? (
              <p className="text-sm text-amber-600">{preview.error}</p>
            ) : preview && preview.chunks.length === 0 ? (
              // Indexed-but-empty is a real state and must not look like a failed load.
              <p className="text-sm text-muted-foreground">
                This document is registered but has no indexed text yet.
              </p>
            ) : (
              preview?.chunks.map((c) => (
                <pre
                  key={c.position}
                  className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed"
                >
                  {c.content}
                </pre>
              ))
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}

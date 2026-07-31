'use client';

import { FilePlus } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { SUPPORTED_UPLOAD_ACCEPT } from '@/lib/upload-formats';
import { postKnowledgeDocument, postKnowledgeFile } from '@/lib/knowledge-intake';
import { noteDocumentName } from '@/lib/knowledge-note';

// A small "quick add document" affordance on each collection card in the Knowledge LIST. It is a
// convenience only — index one document into a collection without leaving the list — NOT the way to
// open a collection (the card links to the deep-linkable detail page for that). Full document
// management (list + delete + upload) lives on /data/knowledge/[id].
//
// Which card's quick-add is open lives in the URL (?panel=quick-add-doc&collection=<id>) so Back
// closes it and it's deep-linkable — never local-only state.
export function QuickAddDocument({
  collectionId,
  collectionName,
}: Readonly<{
  collectionId: string;
  collectionName: string;
}>) {
  const router = useRouter();
  const params = useSearchParams();
  const open =
    params.get('panel') === 'quick-add-doc' && params.get('collection') === collectionId;

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) {
        p.set('panel', 'quick-add-doc');
        p.set('collection', collectionId);
      } else {
        p.delete('panel');
        p.delete('collection');
      }
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router, collectionId],
  );

  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function index(name: string, content: string) {
    setBusy(true);
    const result = await postKnowledgeDocument(collectionId, name, content);
    setBusy(false);
    if (!result.ok) {
      // Refusal vs breakage: a non-admin on a curated collection is the system working correctly.
      (result.failure.refusal ? toast.info : toast.error)(result.failure.message);
      return;
    }
    toast.success(`Indexed "${name}" (${result.chunks} chunks)`);
    setNoteText('');
    setOpen(false);
    router.refresh();
  }

  async function upload(file: File) {
    setBusy(true);
    const result = await postKnowledgeFile(collectionId, file);
    setBusy(false);
    if (result.ok) {
      toast.success(`Indexed "${file.name}" (${result.chunks} chunks)`);
      setOpen(false);
      router.refresh();
    } else {
      (result.failure.refusal ? toast.info : toast.error)(result.failure.message);
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Quick add a document to ${collectionName}`}
      >
        <FilePlus className="mr-1 size-4" /> Add doc
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add a document to {collectionName}</SheetTitle>
            <SheetDescription>
              Index a text document into this collection — it&rsquo;s chunked and embedded on-prem.
              To review or remove documents,{' '}
              <a href={`/data/knowledge/${collectionId}`} className="underline">
                open the collection
              </a>.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Upload a file</p>
              <input
                ref={fileRef}
                type="file"
                accept={SUPPORTED_UPLOAD_ACCEPT}
                disabled={busy}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </div>
            {/* …or paste it. Knowledge is not only files — a clause out of a circular or an email is a
                source too, and it goes down the identical embed path. */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">…or paste text</p>
              <Textarea
                rows={7}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Paste the text this collection should know…"
                className="text-sm"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={busy || !noteText.trim()}
                  onClick={() => index(noteDocumentName(noteText), noteText.trim())}
                >
                  {busy ? 'Indexing…' : 'Index text'}
                </Button>
              </div>
            </div>
            {busy ? <p className="text-xs text-muted-foreground">Indexing…</p> : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

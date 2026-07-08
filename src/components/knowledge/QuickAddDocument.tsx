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

// A small "quick add document" affordance on each collection card in the Knowledge LIST. It is a
// convenience only — index one document into a collection without leaving the list — NOT the way to
// open a collection (the card links to the deep-linkable detail page for that). Full document
// management (list + delete + upload) lives on /workspace/knowledge/[id].
//
// Which card's quick-add is open lives in the URL (?panel=quick-add-doc&collection=<id>) so Back
// closes it and it's deep-linkable — never local-only state.
export function QuickAddDocument({
  collectionId,
  collectionName,
}: {
  collectionId: string;
  collectionName: string;
}) {
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
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const content = await file.text();
      const res = await fetch(`/api/v1/knowledge/collections/${collectionId}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, content }),
      });
      if (!res.ok) throw new Error('failed');
      const { chunks } = await res.json();
      toast.success(`Indexed "${file.name}" (${chunks} chunks)`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to index document');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
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
              <a href={`/workspace/knowledge/${collectionId}`} className="underline">
                open the collection
              </a>
              .
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.csv,.json,text/*"
              disabled={busy}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            {busy ? <p className="mt-1 text-xs text-muted-foreground">Indexing…</p> : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

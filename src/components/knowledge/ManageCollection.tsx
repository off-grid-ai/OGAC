'use client';

import { Gear, Trash } from '@phosphor-icons/react/dist/ssr';
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

interface Doc {
  id: string;
  name: string;
  size: number;
}

// Admin surface for a single collection: upload/index text documents and remove existing ones.
// Files are read client-side and sent as text; the server chunks + embeds them via the gateway.
// Which collection panel is open lives in the URL (?panel=manage-collection&collection=<id>) so
// Back closes it and the panel is deep-linkable — never local-only state.
export function ManageCollection({
  collection,
  documents,
}: {
  collection: { id: string; name: string };
  documents: Doc[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const open =
    params.get('panel') === 'manage-collection' && params.get('collection') === collection.id;

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) {
        p.set('panel', 'manage-collection');
        p.set('collection', collection.id);
      } else {
        p.delete('panel');
        p.delete('collection');
      }
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router, collection.id],
  );

  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const content = await file.text();
      const res = await fetch(`/api/v1/knowledge/collections/${collection.id}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, content }),
      });
      if (!res.ok) throw new Error('failed');
      const { chunks } = await res.json();
      toast.success(`Indexed "${file.name}" (${chunks} chunks)`);
      router.refresh();
    } catch {
      toast.error('Failed to index document');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/v1/knowledge/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success('Removed document');
      router.refresh();
    } catch {
      toast.error('Failed to remove document');
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Gear className="mr-1 size-4" /> Manage
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{collection.name}</SheetTitle>
            <SheetDescription>
              Index text documents into this collection. Each is chunked and embedded on-prem.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
          <div>
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
            {busy && <p className="mt-1 text-xs text-muted-foreground">Indexing…</p>}
          </div>
          <div className="space-y-1">
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents indexed yet.</p>
            ) : (
              documents.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span className="truncate">{d.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${d.name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove(d.id)}
                  >
                    <Trash className="size-4" />
                  </button>
                </div>
              ))
            )}
          </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

'use client';

import { Gear, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Doc {
  id: string;
  name: string;
  size: number;
}

// Admin surface for a single collection: upload/index text documents and remove existing ones.
// Files are read client-side and sent as text; the server chunks + embeds them via the gateway.
export function ManageCollection({
  collection,
  documents,
}: {
  collection: { id: string; name: string };
  documents: Doc[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gear className="mr-1 size-4" /> Manage
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{collection.name}</DialogTitle>
          <DialogDescription>
            Index text documents into this collection. Each is chunked and embedded on-prem.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

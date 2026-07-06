'use client';

import { Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

interface Doc {
  id: string;
  name: string;
  size: number;
  kind: string;
  createdAt: string;
}

// The documents sub-resource for a single collection's DETAIL page: upload/index a text document
// and remove existing ones. Reuses the same endpoints the ManageCollection sheet used — the file is
// read client-side and sent as text; the server chunks + embeds it via the gateway. Read-only for
// non-admins (no controls rendered).
export function CollectionDocuments({
  collectionId,
  documents,
  isAdmin,
}: {
  collectionId: string;
  documents: Doc[];
  isAdmin: boolean;
}) {
  const router = useRouter();
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
      router.refresh();
    } catch {
      toast.error('Failed to index document');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(id: string, name: string) {
    try {
      const res = await fetch(`/api/v1/knowledge/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success(`Removed "${name}"`);
      router.refresh();
    } catch {
      toast.error('Failed to remove document');
    }
  }

  return (
    <div className="space-y-3">
      {isAdmin ? (
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
          {busy ? <p className="mt-1 text-xs text-muted-foreground">Indexing…</p> : null}
        </div>
      ) : null}

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents indexed yet.</p>
      ) : (
        <div className="space-y-1">
          {documents.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{d.name}</div>
                <div className="text-xs text-muted-foreground">
                  {d.kind} · {(d.size / 1024).toFixed(1)} KB · {d.createdAt.slice(0, 10)}
                </div>
              </div>
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
    </div>
  );
}

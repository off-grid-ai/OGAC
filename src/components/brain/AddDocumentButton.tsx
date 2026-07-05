'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

// Open/close state lives in the URL (?panel=new-document) so Back closes the panel.
export function AddDocumentButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-document';

  const [title, setTitle] = useState('');
  const [source, setSource] = useState('KB');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      const sp = new URLSearchParams(params.toString());
      if (next) sp.set('panel', 'new-document');
      else sp.delete('panel');
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  async function create() {
    if (!title.trim() || !text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/brain/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, source, text }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Indexed "${title}"`);
      setTitle('');
      setText('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to index document');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add document
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add to the Brain</SheetTitle>
            <SheetDescription>
              Embedded and indexed into the RAG store for retrieval.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="doc-title">Title</Label>
                <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-source">Source</Label>
                <Input id="doc-source" value={source} onChange={(e) => setSource(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-text">Content</Label>
              <Textarea
                id="doc-text"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="The SOP / knowledge text…"
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} disabled={busy} className="w-full">
              {busy ? 'Indexing…' : 'Index document'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

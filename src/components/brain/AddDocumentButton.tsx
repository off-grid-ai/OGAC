'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function AddDocumentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('KB');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add document
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to the Brain</DialogTitle>
          <DialogDescription>
            Embedded and indexed into the RAG store for retrieval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
          <Button onClick={create} disabled={busy} className="w-full">
            {busy ? 'Indexing…' : 'Index document'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

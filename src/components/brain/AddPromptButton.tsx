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

// Create a prompt template + publish its first version (v1) in one step.
export function AddPromptButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error('failed');
      const prompt = await res.json();
      await fetch(`/api/v1/admin/prompts/${prompt.id}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, label: 'production' }),
      });
      toast.success(`Created "${name}" (v1)`);
      setName('');
      setDescription('');
      setBody('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to create prompt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          New prompt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New prompt template</DialogTitle>
          <DialogDescription>
            Versioned + immutable — publishing a change creates a new version, never overwrites.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Input
              id="p-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-body">Template (v1)</Label>
            <Textarea id="p-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <Button onClick={create} disabled={busy || !name || !body} className="w-full">
            {busy ? 'Creating…' : 'Create v1'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

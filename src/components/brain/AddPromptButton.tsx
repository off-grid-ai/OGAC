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

// Create a prompt template + publish its first version (v1) in one step.
// Open/close state lives in the URL (?panel=new-prompt) so Back closes the panel
// and the create surface is deep-linkable — never local useState.
export function AddPromptButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-prompt';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      const sp = new URLSearchParams(params.toString());
      if (next) sp.set('panel', 'new-prompt');
      else sp.delete('panel');
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

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
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        New prompt
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New prompt template</SheetTitle>
            <SheetDescription>
              Versioned + immutable — publishing a change creates a new version, never overwrites.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
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
              <Textarea
                id="p-body"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} disabled={busy || !name || !body} className="w-full">
              {busy ? 'Creating…' : 'Create v1'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

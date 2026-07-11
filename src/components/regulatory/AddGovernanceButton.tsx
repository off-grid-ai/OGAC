'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

const KINDS = [
  'policy',
  'ethics_review',
  'raci',
  'training',
  'vendor',
  'insurance',
  'drill',
  'impact_assessment',
];

export function AddGovernanceButton() {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-governance';

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', 'new-governance');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const [kind, setKind] = useState('policy');
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/governance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, title, owner, status: 'active' }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Added "${title}"`);
      setTitle('');
      setOwner('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to add item');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add item
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add a governance item</SheetTitle>
            <SheetDescription>
              A tracked, attestable record for the org/regulatory wrapper.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Kind</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      {kind}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {KINDS.map((k) => (
                      <DropdownMenuItem key={k} onClick={() => setKind(k)}>
                        {k}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-title">Title</Label>
                <Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="g-owner">Owner</Label>
                <Input id="g-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} disabled={busy || !title} className="w-full">
              {busy ? 'Adding…' : 'Add item'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

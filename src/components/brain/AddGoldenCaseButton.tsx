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

// Open/close state lives in the URL (?panel=new-goldencase) so Back closes the panel.
export function AddGoldenCaseButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-goldencase';

  const [query, setQuery] = useState('');
  const [expected, setExpected] = useState('');

  const setOpen = useCallback(
    (next: boolean) => {
      const sp = new URLSearchParams(params.toString());
      if (next) sp.set('panel', 'new-goldencase');
      else sp.delete('panel');
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  async function create() {
    if (!query.trim() || !expected.trim()) return;
    const res = await fetch('/api/v1/admin/golden-cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, expected }),
    });
    if (res.ok) {
      toast.success('Golden case added');
      setQuery('');
      setExpected('');
      setOpen(false);
      router.refresh();
    } else {
      toast.error('Failed to add case');
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add case
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add a golden case</SheetTitle>
            <SheetDescription>A query and the source it should retrieve.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor="gc-query">Query</Label>
              <Input id="gc-query" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-expected">Expected (title or source contains)</Label>
              <Input
                id="gc-expected"
                value={expected}
                placeholder="e.g. FNOL, KYC, Objection"
                onChange={(e) => setExpected(e.target.value)}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} className="w-full">
              Add case
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

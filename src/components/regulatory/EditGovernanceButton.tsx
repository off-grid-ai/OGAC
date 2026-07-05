'use client';

import { PencilSimple } from '@phosphor-icons/react/dist/ssr';
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

const STATUSES = ['draft', 'active', 'due', 'expired'];

// Edit a governance record in a URL-driven side panel (?panel=edit-<id>). No modal-as-place: state
// lives in the URL so Back closes the panel. PATCHes the record, then refreshes the server data.
export function EditGovernanceButton({
  id,
  title: initialTitle,
  owner: initialOwner,
  status: initialStatus,
  reviewedAt: initialReviewed,
}: {
  id: string;
  title: string;
  owner: string;
  status: string;
  reviewedAt: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === `edit-${id}`;

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', `edit-${id}`);
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router, id],
  );

  const [title, setTitle] = useState(initialTitle);
  const [owner, setOwner] = useState(initialOwner);
  const [status, setStatus] = useState(initialStatus || 'active');
  const [reviewedAt, setReviewedAt] = useState(initialReviewed);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/governance/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, owner, status, reviewedAt }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Updated "${title}"`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to update item');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${initialTitle}`}>
        <PencilSimple className="size-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit governance item</SheetTitle>
            <SheetDescription>Update the attestable record.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="eg-title">Title</Label>
                <Input id="eg-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eg-owner">Owner</Label>
                <Input id="eg-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      {status}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {STATUSES.map((s) => (
                      <DropdownMenuItem key={s} onClick={() => setStatus(s)}>
                        {s}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eg-reviewed">Reviewed (date)</Label>
                <Input
                  id="eg-reviewed"
                  type="date"
                  value={reviewedAt}
                  onChange={(e) => setReviewedAt(e.target.value)}
                />
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={save} disabled={busy || !title} className="w-full">
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

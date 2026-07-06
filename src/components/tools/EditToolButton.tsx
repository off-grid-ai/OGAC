'use client';

import { PencilSimple } from '@phosphor-icons/react/dist/ssr';
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

// ─── EditToolButton (#121) — edit a registered tool's name / endpoint / description ───────────────
// PATCHes /api/v1/admin/tools/<id> with the changed fields (the route routes a name/endpoint/
// description body to updateTool). Open/close state lives in the URL (?edit=<id>) so Back closes it.
export function EditToolButton({
  id,
  name: initialName,
  endpoint: initialEndpoint,
  description: initialDescription,
}: {
  id: string;
  name: string;
  endpoint: string;
  description: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('edit') === id;

  const [name, setName] = useState(initialName);
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      const sp = new URLSearchParams(params.toString());
      if (next) {
        sp.set('edit', id);
        // Reset the form to the current row values whenever the panel opens.
        setName(initialName);
        setEndpoint(initialEndpoint);
        setDescription(initialDescription);
      } else {
        sp.delete('edit');
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, id, initialName, initialEndpoint, initialDescription],
  );

  async function save() {
    if (!name.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/tools/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, endpoint, description }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Updated "${name}"`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to update tool');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Edit ${initialName}`}
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        <PencilSimple className="size-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit tool</SheetTitle>
            <SheetDescription>
              Update the tool&apos;s name, endpoint, or the &quot;when to use&quot; description the
              router matches against.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-name-${id}`}>Name</Label>
              <Input id={`edit-name-${id}`} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-endpoint-${id}`}>Endpoint</Label>
              <Input
                id={`edit-endpoint-${id}`}
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`edit-desc-${id}`}>When to use</Label>
              <Textarea
                id={`edit-desc-${id}`}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={save} disabled={busy || !name.trim()} className="w-full">
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

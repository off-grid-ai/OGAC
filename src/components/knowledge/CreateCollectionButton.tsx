'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
import { panelHref, withPanelParams } from '@/lib/url-panel';

// Admin-only: create an org knowledge collection and set which roles may retrieve from it.
// allowedRoles is a comma-separated list; empty means every authenticated user. The create panel's
// open/closed state lives in the URL (?panel=new-collection) so Back closes it and it's
// deep-linkable — never in local useState.
export function CreateCollectionButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-collection';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState('');
  const [busy, setBusy] = useState(false);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setRoles('');
    }
  }, [open]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const allowedRoles = roles
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const res = await fetch('/api/v1/knowledge/collections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description, allowedRoles }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Created "${name}"`);
      setPanel(null);
      router.refresh();
    } catch {
      toast.error('Failed to create collection');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setPanel('new-collection')}>
        <Plus className="mr-1 size-4" /> New collection
      </Button>
      <Sheet open={open} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New knowledge collection</SheetTitle>
            <SheetDescription>
              A curated, permission-aware corpus. Leave roles blank to allow everyone.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="kc-name">Name</Label>
              <Input id="kc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kc-desc">Description</Label>
              <Textarea
                id="kc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kc-roles">Allowed roles (comma-separated, blank = everyone)</Label>
              <Input
                id="kc-roles"
                placeholder="e.g. admin, editor"
                value={roles}
                onChange={(e) => setRoles(e.target.value)}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

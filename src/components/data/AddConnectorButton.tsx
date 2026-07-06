'use client';

import { CaretDown as ChevronDown, Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const TYPES = ['postgres', 'mysql', 'snowflake', 's3', 'salesforce', 'gdrive'];

// The create panel's open/closed state lives in the URL (?panel=new-connector) so Back closes it
// and it's deep-linkable — never in local useState.
export function AddConnectorButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-connector';

  const [name, setName] = useState('');
  const [type, setType] = useState('postgres');
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
      setType('postgres');
    }
  }, [open]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Connector "${name}" added`);
      setPanel(null);
      router.refresh();
    } catch {
      toast.error('Failed to add connector');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setPanel('new-connector')}>
        <Plus className="size-4" />
        Add connector
      </Button>
      <FormSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Add a connector"
        description="Connect a database, warehouse, or SaaS source."
        footer={
          <Button onClick={create} disabled={busy} className="w-full">
            {busy ? 'Adding…' : 'Add connector'}
          </Button>
        }
      >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="con-name">Name</Label>
              <Input
                id="con-name"
                value={name}
                placeholder="Core Banking (Postgres)"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {type}
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                  {TYPES.map((t) => (
                    <DropdownMenuItem key={t} onClick={() => setType(t)}>
                      {t}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
      </FormSheet>
    </>
  );
}

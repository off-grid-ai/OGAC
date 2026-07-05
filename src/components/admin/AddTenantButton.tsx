'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function AddTenantButton({ modules }: { modules: { id: string; label: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-tenant';

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', 'new-tenant');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function create() {
    if (!name.trim()) return;
    const res = await fetch('/api/v1/admin/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, enabledModules: selected }),
    });
    if (res.ok) {
      toast.success(`Tenant "${name}" provisioned`);
      setName('');
      setSelected([]);
      setOpen(false);
      router.refresh();
    } else {
      toast.error('Failed to create tenant');
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add tenant
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Provision a tenant</SheetTitle>
            <SheetDescription>Pick which planes this organization gets.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor="tenant-name">Organization</Label>
              <Input id="tenant-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Provisioned planes</Label>
              <div className="flex flex-wrap gap-1.5">
                {modules.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      selected.includes(m.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} className="w-full">
              Provision tenant
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

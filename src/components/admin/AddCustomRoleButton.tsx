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

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

// Define a custom role on top of the built-in RBAC: a name, a built-in role it inherits, and the
// set of module ids it may access (capabilities). Persists to custom_roles.
export function AddCustomRoleButton({ modules }: { modules: { id: string; label: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-role';

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', 'new-role');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const [name, setName] = useState('');
  const [basedOn, setBasedOn] = useState('viewer');
  const [caps, setCaps] = useState<string[]>([]);

  function toggle(id: string) {
    setCaps((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function create() {
    if (!name.trim()) return;
    const res = await fetch('/api/v1/admin/roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, basedOn, capabilities: caps }),
    });
    if (res.ok) {
      toast.success(`Role "${name}" created`);
      setName('');
      setCaps([]);
      setOpen(false);
      router.refresh();
    } else {
      toast.error('Failed to create role');
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add role
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Define a custom role</SheetTitle>
            <SheetDescription>
              Layer a role on the built-in RBAC — it inherits a base role and grants module access.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">Role name</Label>
                <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-base">Inherits</Label>
                <select
                  id="role-base"
                  value={basedOn}
                  onChange={(e) => setBasedOn(e.target.value)}
                  className={SELECT}
                >
                  <option value="viewer">viewer</option>
                  <option value="operator">operator</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Module access</Label>
                <div className="flex flex-wrap gap-1.5">
                  {modules.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(m.id)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition-colors',
                        caps.includes(m.id)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} className="w-full">
              Create role
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

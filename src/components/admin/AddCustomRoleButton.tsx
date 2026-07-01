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
import { cn } from '@/lib/utils';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

// Define a custom role on top of the built-in RBAC: a name, a built-in role it inherits, and the
// set of module ids it may access (capabilities). Persists to custom_roles.
export function AddCustomRoleButton({ modules }: { modules: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Define a custom role</DialogTitle>
          <DialogDescription>
            Layer a role on the built-in RBAC — it inherits a base role and grants module access.
          </DialogDescription>
        </DialogHeader>
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
          <Button onClick={create} className="w-full">
            Create role
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

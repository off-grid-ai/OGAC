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

const ACTIONS = ['local', 'cloud', 'block'] as const;

export function AddRoutingRuleButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [attribute, setAttribute] = useState('data_class');
  const [value, setValue] = useState('');
  const [action, setAction] = useState<(typeof ACTIONS)[number]>('local');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim() || !value.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/routing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, attribute, operator: 'eq', value, action, model }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Added "${name}"`);
      setName('');
      setValue('');
      setModel('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to add rule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add rule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a routing rule</DialogTitle>
          <DialogDescription>
            If a request&apos;s attribute matches, it routes to the chosen target. Cloud is leashed
            by the org egress switch.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="r-name">Name</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-attr">Attribute</Label>
              <Input
                id="r-attr"
                value={attribute}
                onChange={(e) => setAttribute(e.target.value)}
                placeholder="data_class | task | cost"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-val">Equals</Label>
              <Input
                id="r-val"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="pii | longcontext | low"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Route to</Label>
            <div className="flex gap-2">
              {ACTIONS.map((a) => (
                <Button
                  key={a}
                  type="button"
                  size="sm"
                  variant={action === a ? 'default' : 'outline'}
                  onClick={() => setAction(a)}
                >
                  {a}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-model">Model (optional)</Label>
            <Input
              id="r-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gemma-local | cloud-claude"
            />
          </div>
          <Button onClick={create} disabled={busy || !name || !value} className="w-full">
            {busy ? 'Adding…' : 'Add rule'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

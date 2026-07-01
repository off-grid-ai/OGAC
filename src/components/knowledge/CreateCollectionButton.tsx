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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Admin-only: create an org knowledge collection and set which roles may retrieve from it.
// allowedRoles is a comma-separated list; empty means every authenticated user.
export function CreateCollectionButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState('');
  const [busy, setBusy] = useState(false);

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
      setName('');
      setDescription('');
      setRoles('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to create collection');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 size-4" /> New collection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New knowledge collection</DialogTitle>
          <DialogDescription>
            A curated, permission-aware corpus. Leave roles blank to allow everyone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

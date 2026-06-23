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
import { Textarea } from '@/components/ui/textarea';

const TYPES = ['http', 'mcp'] as const;

export function AddToolButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('http');
  const [endpoint, setEndpoint] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type, endpoint, description }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Registered "${name}"`);
      setName('');
      setEndpoint('');
      setDescription('');
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to register tool');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Register tool
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register a tool</DialogTitle>
          <DialogDescription>
            The router invokes it when a query&apos;s intent matches the &quot;when to use&quot;
            description.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tool-name">Name</Label>
            <Input id="tool-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={type === t ? 'default' : 'outline'}
                  onClick={() => setType(t)}
                >
                  {t.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tool-endpoint">Endpoint</Label>
            <Input
              id="tool-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={type === 'mcp' ? 'mcp://server' : 'https://service/api'}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tool-desc">When to use</Label>
            <Textarea
              id="tool-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this tool does — used to match query intent."
            />
          </div>
          <Button onClick={create} disabled={busy || !name} className="w-full">
            {busy ? 'Registering…' : 'Register tool'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

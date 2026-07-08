'use client';

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

// Per-key request rate limit editor, rendered inline in the keys roster. Reads the key's current
// limit lazily when opened (GET /api/v1/admin/keys/[id]) and saves via PATCH { rateLimit }. A blank
// value clears the per-key limit → the key falls back to the workspace / global default.
export function KeyRateLimit({ id, label }: { id: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [current, setCurrent] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/v1/admin/keys/${id}`);
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { rateLimit: number | null };
      setCurrent(data.rateLimit);
      setValue(data.rateLimit == null ? '' : String(data.rateLimit));
    } catch {
      setCurrent(null);
      setValue('');
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  async function save() {
    setBusy(true);
    try {
      const rateLimit = value.trim() === '' ? null : Math.max(0, Math.floor(Number(value)));
      if (rateLimit !== null && !Number.isFinite(rateLimit)) throw new Error('bad');
      const res = await fetch(`/api/v1/admin/keys/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rateLimit }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(
        rateLimit === null
          ? `Rate limit cleared${label ? ` for ${label}` : ''}`
          : `Rate limit set to ${rateLimit}/min${label ? ` for ${label}` : ''}`,
      );
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Failed to update rate limit');
    } finally {
      setBusy(false);
    }
  }

  const summary =
    current === undefined ? 'set limit' : current === null ? 'default' : `${current}/min`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          {summary}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rate limit{label ? ` — ${label}` : ''}</DialogTitle>
          <DialogDescription>
            Caps how fast this key can call the API, in requests per minute. Leave blank to use the
            workspace default.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`rl-${id}`}>Requests / min</Label>
          <Input
            id={`rl-${id}`}
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="blank = workspace default"
          />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy} size="sm" className="w-full">
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

export function AddGoldenCaseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expected, setExpected] = useState('');

  async function create() {
    if (!query.trim() || !expected.trim()) return;
    const res = await fetch('/api/v1/admin/golden-cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, expected }),
    });
    if (res.ok) {
      toast.success('Golden case added');
      setQuery('');
      setExpected('');
      setOpen(false);
      router.refresh();
    } else {
      toast.error('Failed to add case');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Add case
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a golden case</DialogTitle>
          <DialogDescription>A query and the source it should retrieve.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gc-query">Query</Label>
            <Input id="gc-query" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gc-expected">Expected (title or source contains)</Label>
            <Input
              id="gc-expected"
              value={expected}
              placeholder="e.g. FNOL, KYC, Objection"
              onChange={(e) => setExpected(e.target.value)}
            />
          </div>
          <Button onClick={create} className="w-full">
            Add case
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

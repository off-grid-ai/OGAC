'use client';

import { CaretDown as ChevronDown, Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ACTIONS = ['mask', 'tokenize', 'block'];

export function AddMaskingRuleButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('');
  const [action, setAction] = useState('mask');

  async function create() {
    if (!kind.trim()) return;
    const res = await fetch('/api/v1/admin/masking-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, action }),
    });
    if (res.ok) {
      toast.success(`Rule for "${kind}" added`);
      setKind('');
      setOpen(false);
      router.refresh();
    } else {
      toast.error('Failed to add rule');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Add rule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a masking rule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rule-kind">PII type</Label>
            <Input
              id="rule-kind"
              value={kind}
              placeholder="email, phone, pan, aadhaar…"
              onChange={(e) => setKind(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Action</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {action}
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                {ACTIONS.map((a) => (
                  <DropdownMenuItem key={a} onClick={() => setAction(a)}>
                    {a}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button onClick={create} className="w-full">
            Add rule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

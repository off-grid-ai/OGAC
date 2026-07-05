'use client';

import { CaretDown as ChevronDown, Plus } from '@phosphor-icons/react/dist/ssr';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const OPS = ['eq', 'neq', 'in'];
const EFFECTS = ['allow', 'deny'];

function Picker({
  value,
  options,
  onPick,
}: {
  value: string;
  options: string[];
  onPick: (v: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          {value}
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
        {options.map((o) => (
          <DropdownMenuItem key={o} onClick={() => onPick(o)}>
            {o}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AddAbacRuleButton() {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-abac';

  const setOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', 'new-abac');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const [role, setRole] = useState('*');
  const [resource, setResource] = useState('audit');
  const [attribute, setAttribute] = useState('data_class');
  const [operator, setOperator] = useState('eq');
  const [value, setValue] = useState('pii');
  const [effect, setEffect] = useState('deny');

  async function create() {
    const res = await fetch('/api/v1/admin/abac-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role, resource, attribute, operator, value, effect }),
    });
    if (res.ok) {
      toast.success('ABAC rule added');
      setOpen(false);
      router.refresh();
    } else {
      toast.error('Failed to add rule');
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add rule
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add an ABAC rule</SheetTitle>
            <SheetDescription>Attribute-based access — deny overrides allow.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input value={role} onChange={(e) => setRole(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Resource</Label>
                <Input value={resource} onChange={(e) => setResource(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Attribute</Label>
                <Input value={attribute} onChange={(e) => setAttribute(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Operator</Label>
                <Picker value={operator} options={OPS} onPick={setOperator} />
              </div>
              <div className="space-y-1.5">
                <Label>Value</Label>
                <Input value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Effect</Label>
                <Picker value={effect} options={EFFECTS} onPick={setEffect} />
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} className="w-full">
              Add rule
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

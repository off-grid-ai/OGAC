'use client';

import { CaretDown as ChevronDown, Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
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
import { panelHref, withPanelParams } from '@/lib/url-panel';

const ACTIONS = ['mask', 'tokenize', 'block'];

// The create panel's open/closed state lives in the URL (?panel=new-masking-rule) so Back closes
// it and it's deep-linkable — never in local useState.
export function AddMaskingRuleButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-masking-rule';

  const [kind, setKind] = useState('');
  const [action, setAction] = useState('mask');

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (open) {
      setKind('');
      setAction('mask');
    }
  }, [open]);

  async function create() {
    if (!kind.trim()) return;
    const res = await fetch('/api/v1/admin/masking-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, action }),
    });
    if (res.ok) {
      toast.success(`Rule for "${kind}" added`);
      setPanel(null);
      router.refresh();
    } else {
      toast.error('Failed to add rule');
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setPanel('new-masking-rule')}>
        <Plus className="size-4" />
        Add rule
      </Button>
      <Sheet open={open} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add a masking rule</SheetTitle>
          </SheetHeader>
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
        </SheetContent>
      </Sheet>
    </>
  );
}

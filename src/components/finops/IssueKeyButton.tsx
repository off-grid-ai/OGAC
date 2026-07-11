'use client';

import { Copy, Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const TYPES = ['user', 'project'] as const;

export function IssueKeyButton() {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-key';

  const setPanelOpen = useCallback(
    (next: boolean) => {
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', 'new-key');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const [name, setName] = useState('');
  const [subjectType, setSubjectType] = useState<(typeof TYPES)[number]>('user');
  const [subject, setSubject] = useState('');
  const [budget, setBudget] = useState('');
  const [rateLimit, setRateLimit] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  async function issue() {
    if (!name.trim() || !subject.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          subjectType,
          subject,
          budgetUsd: budget ? Number(budget) : null,
          rateLimit: rateLimit ? Number(rateLimit) : null,
        }),
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setToken(data.token);
      setName('');
      setSubject('');
      setBudget('');
      setRateLimit('');
      router.refresh();
    } catch {
      toast.error('Failed to issue key');
    } finally {
      setBusy(false);
    }
  }

  function close(o: boolean) {
    setPanelOpen(o);
    if (!o) setToken('');
  }

  return (
    <>
      <Button size="sm" onClick={() => setPanelOpen(true)}>
        <Plus className="size-4" />
        Issue key
      </Button>
      <Sheet open={open} onOpenChange={close}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Issue a virtual key</SheetTitle>
            <SheetDescription>
              Scoped to a user or project, with an optional monthly budget and request rate limit.
              The secret is shown once.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {token ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Copy this token now — it won&apos;t be shown again.
                </p>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-2">
                  <code className="flex-1 truncate text-xs text-foreground">{token}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(token);
                      toast.success('Copied');
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <Button onClick={() => close(false)} className="w-full">
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="k-name">Name</Label>
                  <Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Scope</Label>
                  <div className="flex gap-2">
                    {TYPES.map((t) => (
                      <Button
                        key={t}
                        type="button"
                        size="sm"
                        variant={subjectType === t ? 'default' : 'outline'}
                        onClick={() => setSubjectType(t)}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="k-subject">{subjectType === 'user' ? 'User' : 'Project'}</Label>
                    <Input
                      id="k-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="k-budget">Budget (USD/mo)</Label>
                    <Input
                      id="k-budget"
                      type="number"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="optional"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="k-rate">Rate limit (requests / min)</Label>
                  <Input
                    id="k-rate"
                    type="number"
                    min={0}
                    value={rateLimit}
                    onChange={(e) => setRateLimit(e.target.value)}
                    placeholder="optional — defaults to the workspace limit"
                  />
                  <p className="text-xs text-muted-foreground">
                    Caps how fast this key can call the API. Leave blank to use the workspace
                    default.
                  </p>
                </div>
                <Button onClick={issue} disabled={busy || !name || !subject} className="w-full">
                  {busy ? 'Issuing…' : 'Issue key'}
                </Button>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

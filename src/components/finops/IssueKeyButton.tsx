'use client';

import { Copy, Plus } from '@phosphor-icons/react/dist/ssr';
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

const TYPES = ['user', 'project'] as const;

export function IssueKeyButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [subjectType, setSubjectType] = useState<(typeof TYPES)[number]>('user');
  const [subject, setSubject] = useState('');
  const [budget, setBudget] = useState('');
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
        }),
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setToken(data.token);
      setName('');
      setSubject('');
      setBudget('');
      router.refresh();
    } catch {
      toast.error('Failed to issue key');
    } finally {
      setBusy(false);
    }
  }

  function close(o: boolean) {
    setOpen(o);
    if (!o) setToken('');
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Issue key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue a virtual key</DialogTitle>
          <DialogDescription>
            Scoped to a user or project, with an optional monthly budget. The secret is shown once.
          </DialogDescription>
        </DialogHeader>

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
            <div className="grid grid-cols-2 gap-3">
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
            <Button onClick={issue} disabled={busy || !name || !subject} className="w-full">
              {busy ? 'Issuing…' : 'Issue key'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

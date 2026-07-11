'use client';

import { Plus, Trash, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  POLICY_EFFECTS,
  POLICY_OPERATORS,
  type PolicyEffect,
  type PolicyOperator,
  type PolicyRule,
} from '@/lib/policy-rules-policy';

// Full management surface for console-owned policy rules: table with Add / Edit / Delete, an
// enable toggle, and the "Push / Reload to OPA" action. Navigation (which dialog is open, which
// rule is being edited) lives in the URL (?rule=new | ?rule=<id>) so Back closes the dialog and the
// view is deep-linkable — never local-only state.

interface FormState {
  name: string;
  description: string;
  attribute: string;
  operator: PolicyOperator;
  value: string;
  effect: PolicyEffect;
  priority: string;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  attribute: 'role',
  operator: 'eq',
  value: '',
  effect: 'deny',
  priority: '100',
};

export function PolicyRulesManager({ rules }: Readonly<{ rules: PolicyRule[] }>) {
  const router = useRouter();
  const params = useSearchParams();
  const editing = params.get('rule'); // null | 'new' | '<id>'

  const setEditing = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set('rule', id);
      else next.delete('rule');
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const current = useMemo(
    () => (editing && editing !== 'new' ? rules.find((r) => r.id === editing) : undefined),
    [editing, rules],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Console-owned allow/deny entries, evaluated deny-first by ascending priority. Push
          compiles the enabled set into a policy data document and reloads the policy engine.
        </p>
        <div className="flex gap-2">
          <PushButton count={rules.filter((r) => r.enabled).length} />
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Add rule
          </Button>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          No policy rules yet. Add one to start building the allow/deny set.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Priority</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Effect</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-muted-foreground">{r.priority}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    className="text-left font-medium hover:underline"
                    onClick={() => setEditing(r.id)}
                  >
                    {r.name}
                  </button>
                  {r.description ? (
                    <div className="text-xs text-muted-foreground">{r.description}</div>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {r.attribute} {r.operator} {r.value}
                </TableCell>
                <TableCell>
                  <Badge variant={r.effect === 'allow' ? 'default' : 'destructive'}>
                    {r.effect}
                  </Badge>
                </TableCell>
                <TableCell>
                  <EnableToggle id={r.id} enabled={r.enabled} />
                </TableCell>
                <TableCell className="text-right">
                  <DeleteButton id={r.id} name={r.name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing != null ? (
        <RuleDialog key={editing} open rule={current} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function PushButton({ count }: Readonly<{ count: number }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function push() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/policy/push', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'failed');
      toast[body.pushed ? 'success' : 'message'](body.reason ?? 'Compiled bundle');
      router.refresh();
    } catch (e) {
      toast.error(`Push failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={push} disabled={busy}>
      <UploadSimple className="size-4" />
      {busy ? 'Pushing…' : `Push / Reload policy engine (${count})`}
    </Button>
  );
}

function EnableToggle({ id, enabled }: Readonly<{ id: string; enabled: boolean }>) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  async function toggle(next: boolean) {
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/policy/rules/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setOn(!next);
      toast.error('Failed to update rule');
    } finally {
      setBusy(false);
    }
  }
  return <Switch checked={on} disabled={busy} onCheckedChange={toggle} />;
}

function DeleteButton({ id, name }: Readonly<{ id: string; name: string }>) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/policy/rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      toast.success(`Deleted "${name}"`);
      router.refresh();
    } catch {
      toast.error('Failed to delete rule');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  return (
    <Dialog open={confirm} onOpenChange={setConfirm}>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label="Delete rule">
        <Trash className="size-4" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete policy rule</DialogTitle>
          <DialogDescription>
            Delete &quot;{name}&quot;? This cannot be undone. Push to the policy engine afterwards to
            propagate.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleDialog({
  open,
  rule,
  onClose,
}: Readonly<{
  open: boolean;
  rule: PolicyRule | undefined;
  onClose: () => void;
}>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const initial: FormState = rule
    ? {
        name: rule.name,
        description: rule.description,
        attribute: rule.attribute,
        operator: rule.operator,
        value: rule.value,
        effect: rule.effect,
        priority: String(rule.priority),
      }
    : EMPTY;
  // Keyed remount (below) resets these on open/target change.
  const [form, setForm] = useState<FormState>(initial);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        attribute: form.attribute,
        operator: form.operator,
        value: form.value,
        effect: form.effect,
        priority: Number(form.priority),
      };
      const res = rule
        ? await fetch(`/api/v1/admin/policy/rules/${rule.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/v1/admin/policy/rules', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'failed');
      toast.success(rule ? `Updated "${form.name}"` : `Added "${form.name}"`);
      onClose();
      router.refresh();
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{rule ? 'Edit policy rule' : 'Add policy rule'}</SheetTitle>
          <SheetDescription>
            When a request&apos;s attribute matches the condition, the effect applies. Deny
            overrides allow.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea
              id="p-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-attr">Attribute</Label>
              <Input
                id="p-attr"
                value={form.attribute}
                onChange={(e) => set('attribute', e.target.value)}
                placeholder="role | data_class"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-op">Operator</Label>
              <select
                id="p-op"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.operator}
                onChange={(e) => set('operator', e.target.value as PolicyOperator)}
              >
                {POLICY_OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-val">Value</Label>
              <Input
                id="p-val"
                value={form.value}
                onChange={(e) => set('value', e.target.value)}
                placeholder="admin | pii"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Effect</Label>
              <div className="flex gap-2">
                {POLICY_EFFECTS.map((eff) => (
                  <Button
                    key={eff}
                    type="button"
                    size="sm"
                    variant={form.effect === eff ? 'default' : 'outline'}
                    onClick={() => set('effect', eff)}
                  >
                    {eff}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-prio">Priority</Label>
              <Input
                id="p-prio"
                type="number"
                value={form.priority}
                onChange={(e) => set('priority', e.target.value)}
              />
            </div>
          </div>
        </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !form.name.trim() || !form.value.trim()}>
            {busy ? 'Saving…' : rule ? 'Save changes' : 'Add rule'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

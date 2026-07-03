'use client';

import { PencilSimple, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Guardrails masking-rules management surface. Full CRUD over console-owned PII/masking rules:
// add (entity name or regex → redact|mask|hash|allow), edit, delete-with-confirmation, and a
// per-row enable toggle. Talks to /api/v1/admin/guardrails/rules[/:id]; refreshes the server
// component after each mutation so the table stays the single source of truth.

const MATCHERS = ['entity', 'regex'] as const;
const ACTIONS = ['redact', 'mask', 'hash', 'allow'] as const;

export interface Rule {
  id: string;
  matcher: 'entity' | 'regex';
  pattern: string;
  action: 'redact' | 'mask' | 'hash' | 'allow';
  label: string;
  enabled: boolean;
  createdAt: string;
}

interface Draft {
  matcher: 'entity' | 'regex';
  pattern: string;
  action: 'redact' | 'mask' | 'hash' | 'allow';
  label: string;
}

const EMPTY: Draft = { matcher: 'entity', pattern: '', action: 'redact', label: '' };

export function GuardrailRules({ rules }: { rules: Rule[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY);
    setOpen(true);
  }
  function openEdit(r: Rule) {
    setEditing(r);
    setDraft({ matcher: r.matcher, pattern: r.pattern, action: r.action, label: r.label });
    setOpen(true);
  }

  async function save() {
    if (!draft.pattern.trim()) {
      toast.error('Pattern is required');
      return;
    }
    setBusy(true);
    const url = editing
      ? `/api/v1/admin/guardrails/rules/${editing.id}`
      : '/api/v1/admin/guardrails/rules';
    const res = await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(editing ? 'Rule updated' : 'Rule added');
      setOpen(false);
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? 'Failed to save rule');
    }
  }

  async function toggle(r: Rule, enabled: boolean) {
    const res = await fetch(`/api/v1/admin/guardrails/rules/${r.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      toast.error('Failed to toggle rule');
    }
  }

  async function remove(r: Rule) {
    const what = r.label || r.pattern;
    if (!window.confirm(`Delete guardrail rule "${what}"? This can't be undone.`)) return;
    const res = await fetch(`/api/v1/admin/guardrails/rules/${r.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Rule deleted');
      router.refresh();
    } else {
      toast.error('Failed to delete rule');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Console-owned masking rules. Each maps an entity type or regex to an action.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="size-4" />
              Add rule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit rule' : 'Add a rule'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Matcher</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {draft.matcher}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                    {MATCHERS.map((m) => (
                      <DropdownMenuItem key={m} onClick={() => setDraft((d) => ({ ...d, matcher: m }))}>
                        {m}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-pattern">
                  {draft.matcher === 'entity' ? 'Entity type' : 'Regex pattern'}
                </Label>
                <Input
                  id="rule-pattern"
                  value={draft.pattern}
                  placeholder={draft.matcher === 'entity' ? 'US_SSN, CREDIT_CARD…' : '\\bACME-\\d+\\b'}
                  onChange={(e) => setDraft((d) => ({ ...d, pattern: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Action</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {draft.action}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                    {ACTIONS.map((a) => (
                      <DropdownMenuItem key={a} onClick={() => setDraft((d) => ({ ...d, action: a }))}>
                        {a}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-label">Label (optional)</Label>
                <Input
                  id="rule-label"
                  value={draft.label}
                  placeholder="Why this rule exists"
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                />
              </div>
              <Button onClick={save} className="w-full" disabled={busy}>
                {editing ? 'Save changes' : 'Add rule'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Matcher</TableHead>
            <TableHead>Pattern</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="text-right">Manage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No rules yet — the always-on regex floor still applies.
              </TableCell>
            </TableRow>
          ) : (
            rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge variant="secondary">{r.matcher}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.pattern}</TableCell>
                <TableCell className="font-mono text-xs">{r.action}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.label || '—'}</TableCell>
                <TableCell>
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) => void toggle(r, v)}
                    aria-label="Toggle rule"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="Edit rule">
                      <PencilSimple className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void remove(r)}
                      title="Delete rule"
                    >
                      <Trash className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

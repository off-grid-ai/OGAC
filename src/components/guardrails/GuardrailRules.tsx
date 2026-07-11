'use client';

import { PencilSimple, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
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
import { toggleMessage } from '@/lib/toast-messages';

// Guardrails masking-rules management surface. Full CRUD over console-owned PII/masking rules:
// add (entity name or regex → redact|mask|hash|allow|block|flag|log), edit, delete-with-confirmation,
// and a per-row enable toggle. Talks to /api/v1/admin/guardrails/rules[/:id]; refreshes the server
// component after each mutation so the table stays the single source of truth.

const MATCHERS = ['entity', 'regex'] as const;
// The enforcement-strength ladder — transform (redact/mask/hash), exempt (allow), deny (block), or
// observe (flag/log). Kept in step with RULE_ACTIONS in src/lib/guardrails-rules.ts.
const ACTIONS = ['redact', 'mask', 'hash', 'allow', 'block', 'flag', 'log'] as const;
type Action = (typeof ACTIONS)[number];

// One-line "what this action does" — shown under the picker so an operator picks enforcement
// strength deliberately (transform vs deny vs observe) rather than guessing from the verb.
const ACTION_HELP: Record<Action, string> = {
  redact: 'Replace matches with a typed placeholder.',
  mask: 'Hide matches behind a fixed-width mask.',
  hash: 'Swap matches for a stable pseudonym token.',
  allow: 'Explicitly permit this pattern (exemption).',
  block: 'Deny the run when this pattern matches (hard stop).',
  flag: 'Allow the run but record a warning.',
  log: 'Allow the run but record a warning.',
};

export interface Rule {
  id: string;
  matcher: 'entity' | 'regex';
  pattern: string;
  action: Action;
  label: string;
  enabled: boolean;
  createdAt: string;
}

interface Draft {
  matcher: 'entity' | 'regex';
  pattern: string;
  action: Action;
  label: string;
}

const EMPTY: Draft = { matcher: 'entity', pattern: '', action: 'redact', label: '' };

export function GuardrailRules({ rules }: Readonly<{ rules: Rule[] }>) {
  const router = useRouter();
  const params = useSearchParams();
  // Which panel is open lives in the URL: ?panel=new-mask (create) or ?panel=edit-mask&id=<id>.
  const panel = params.get('panel');
  const editId = params.get('id');
  const editing =
    panel === 'edit-mask' && editId ? (rules.find((r) => r.id === editId) ?? null) : null;
  const open = panel === 'new-mask' || (panel === 'edit-mask' && editing !== null);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  const setPanel = useCallback(
    (next: 'new-mask' | { id: string } | null) => {
      const p = new URLSearchParams(params.toString());
      if (next === null) {
        p.delete('panel');
        p.delete('id');
      } else if (next === 'new-mask') {
        p.set('panel', 'new-mask');
        p.delete('id');
      } else {
        p.set('panel', 'edit-mask');
        p.set('id', next.id);
      }
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const setOpen = useCallback((o: boolean) => !o && setPanel(null), [setPanel]);

  // Seed the draft from the URL-selected target whenever it changes (open, switch rows, create).
  useEffect(() => {
    if (panel === 'new-mask') {
      setDraft(EMPTY);
    } else if (editing) {
      setDraft({
        matcher: editing.matcher,
        pattern: editing.pattern,
        action: editing.action,
        label: editing.label,
      });
    }
  }, [panel, editing]);

  function openCreate() {
    setPanel('new-mask');
  }
  function openEdit(r: Rule) {
    setPanel({ id: r.id });
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
      setPanel(null);
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
      toast.success(toggleMessage(r.label || r.pattern, enabled, 'Rule'));
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
        <Button size="sm" variant="outline" onClick={openCreate}>
          <Plus className="size-4" />
          Add rule
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{editing ? 'Edit rule' : 'Add a rule'}</SheetTitle>
            </SheetHeader>
            <SheetBody>
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
                        <DropdownMenuItem
                          key={m}
                          onClick={() => setDraft((d) => ({ ...d, matcher: m }))}
                        >
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
                    placeholder={
                      draft.matcher === 'entity' ? 'US_SSN, CREDIT_CARD…' : String.raw`\bACME-\d+\b`
                    }
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
                        <DropdownMenuItem
                          key={a}
                          onClick={() => setDraft((d) => ({ ...d, action: a }))}
                        >
                          {a}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p className="text-xs text-muted-foreground">{ACTION_HELP[draft.action]}</p>
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
              </div>
            </SheetBody>
            <SheetFooter>
              <Button onClick={save} className="w-full" disabled={busy}>
                {editing ? 'Save changes' : 'Add rule'}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
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

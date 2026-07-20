'use client';

import { PencilSimple, Plus, Trash, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { toggleMessage } from '@/lib/toast-messages';

// Custom Presidio data-movement recognizers. Full CRUD over console-owned recognizers that
// become Presidio `ad_hoc_recognizers` on data redaction `/analyze` calls: a regex recognizer
// + context words that boost confidence) or a `deny_list` recognizer (literal terms). Add/edit is
// an INLINE panel (no modal), delete-with-confirmation, and a per-row enable toggle. Talks to
// /api/v1/admin/guardrails/recognizers[/:id]; refreshes the server component after each mutation.

const KINDS = ['pattern', 'deny_list'] as const;
type Kind = (typeof KINDS)[number];

export interface Recognizer {
  id: string;
  kind: Kind;
  entity: string;
  name: string;
  regex: string;
  context: string[];
  denyList: string[];
  score: number;
  enabled: boolean;
  createdAt: string;
}

interface Draft {
  kind: Kind;
  entity: string;
  name: string;
  regex: string;
  context: string; // comma/newline-separated in the form
  denyList: string; // comma/newline-separated in the form
  score: number;
}

const EMPTY: Draft = {
  kind: 'pattern',
  entity: '',
  name: '',
  regex: '',
  context: '',
  denyList: '',
  score: 0.6,
};

export function PresidioRecognizers({ recognizers }: Readonly<{ recognizers: Recognizer[] }>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recognizer | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY);
    setOpen(true);
  }
  function openEdit(r: Recognizer) {
    setEditing(r);
    setDraft({
      kind: r.kind,
      entity: r.entity,
      name: r.name,
      regex: r.regex,
      context: r.context.join(', '),
      denyList: r.denyList.join(', '),
      score: r.score,
    });
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setEditing(null);
    setDraft(EMPTY);
  }

  async function save() {
    if (!draft.entity.trim()) {
      toast.error('Entity type is required');
      return;
    }
    setBusy(true);
    const url = editing
      ? `/api/v1/admin/guardrails/recognizers/${editing.id}`
      : '/api/v1/admin/guardrails/recognizers';
    const res = await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: draft.kind,
        entity: draft.entity,
        name: draft.name,
        regex: draft.regex,
        context: draft.context,
        denyList: draft.denyList,
        score: draft.score,
      }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(editing ? 'Recognizer updated' : 'Recognizer added');
      close();
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? 'Failed to save recognizer');
    }
  }

  async function toggle(r: Recognizer, enabled: boolean) {
    const res = await fetch(`/api/v1/admin/guardrails/recognizers/${r.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      toast.success(toggleMessage(r.name || r.entity, enabled, 'Recognizer'));
      router.refresh();
    } else toast.error('Failed to toggle recognizer');
  }

  async function remove(r: Recognizer) {
    if (!window.confirm(`Delete recognizer "${r.name || r.entity}"? This can't be undone.`)) return;
    const res = await fetch(`/api/v1/admin/guardrails/recognizers/${r.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Recognizer deleted');
      router.refresh();
    } else {
      toast.error('Failed to delete recognizer');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Custom PII patterns for Presidio data-movement redaction. They do not change the static
          prompt/output scanner policy managed by the fleet. A pattern matches a regex (with
          optional context words); a deny list flags literal terms.
        </p>
        {!open ? (
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="size-4" />
            Add recognizer
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-4 rounded-md border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              {editing ? 'Edit recognizer' : 'New recognizer'}
            </p>
            <Button size="icon" variant="ghost" onClick={close} title="Cancel">
              <X className="size-4" />
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>Kind</Label>
            <div className="flex gap-2">
              {KINDS.map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={draft.kind === k ? 'default' : 'outline'}
                  onClick={() => setDraft((d) => ({ ...d, kind: k }))}
                >
                  {k}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-entity">Entity type (UPPER_SNAKE)</Label>
              <Input
                id="rec-entity"
                value={draft.entity}
                placeholder="EMPLOYEE_ID"
                onChange={(e) => setDraft((d) => ({ ...d, entity: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-name">Name (optional)</Label>
              <Input
                id="rec-name"
                value={draft.name}
                placeholder="employee_id_recognizer"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
          </div>

          {draft.kind === 'pattern' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="rec-regex">Regex pattern</Label>
                <Input
                  id="rec-regex"
                  value={draft.regex}
                  placeholder="\\bEMP-\\d{6}\\b"
                  onChange={(e) => setDraft((d) => ({ ...d, regex: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-context">Context words (comma/newline-separated, optional)</Label>
                <Textarea
                  id="rec-context"
                  value={draft.context}
                  placeholder="employee, staff, badge"
                  onChange={(e) => setDraft((d) => ({ ...d, context: e.target.value }))}
                />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rec-deny">Deny-list terms (comma/newline-separated)</Label>
              <Textarea
                id="rec-deny"
                value={draft.denyList}
                placeholder="Project Orion, internal-codename, ACME-SECRET"
                onChange={(e) => setDraft((d) => ({ ...d, denyList: e.target.value }))}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rec-score">Confidence score (0–1): {draft.score.toFixed(2)}</Label>
            <input
              id="rec-score"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={draft.score}
              onChange={(e) => setDraft((d) => ({ ...d, score: Number(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {editing ? 'Save changes' : 'Add recognizer'}
            </Button>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kind</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Match</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="text-right">Manage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recognizers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No custom recognizers yet — the built-in recognizer catalog still applies.
              </TableCell>
            </TableRow>
          ) : (
            recognizers.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge variant="secondary">{r.kind}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.entity}</TableCell>
                <TableCell className="max-w-[24ch] truncate font-mono text-xs" title={r.kind === 'pattern' ? r.regex : r.denyList.join(', ')}>
                  {r.kind === 'pattern' ? r.regex : r.denyList.join(', ')}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.score.toFixed(2)}</TableCell>
                <TableCell>
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) => void toggle(r, v)}
                    aria-label="Toggle recognizer"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="Edit">
                      <PencilSimple className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => void remove(r)} title="Delete">
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

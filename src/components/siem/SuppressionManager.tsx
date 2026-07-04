'use client';

import { Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Rule {
  id: string;
  kind: string;
  pattern: string;
  note: string;
  createdAt: string;
}

const KINDS = ['actor', 'ip', 'action'] as const;
const KIND_HINT: Record<string, string> = {
  actor: 'e.g. a service account like svc-healthcheck',
  ip: 'e.g. a known scanner 10.0.0.5',
  action: 'e.g. GET /healthz',
};

// Suppression rules for the SIEM feed — mute known-noise events so the security stream stays
// signal. Add/delete drive real POST/DELETE routes; the page re-reads and re-applies them
// server-side (router.refresh) so tiles and facets reflect the change immediately.
export function SuppressionManager({ rules }: { rules: Rule[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('actor');
  const [pattern, setPattern] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!pattern.trim() || busy) return;
    setBusy(true);
    const res = await fetch('/api/v1/admin/siem/suppressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, pattern, note }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Suppressing ${kind} matching "${pattern}"`);
      setPattern('');
      setNote('');
      router.refresh();
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(d.error ?? 'Failed to add suppression');
    }
  }

  async function remove(id: string, label: string) {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/siem/suppressions/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) {
      toast.success(`Removed suppression for "${label}"`);
      router.refresh();
    } else {
      toast.error('Failed to remove suppression');
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Suppression rules</CardTitle>
        <p className="text-xs text-muted-foreground">
          Mute known-noise events so the feed stays signal. A rule drops any event whose actor, IP,
          or action contains the pattern (case-insensitive). Applied to the whole view above.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[auto_1fr_1fr_auto]">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Field</Label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Pattern
            </Label>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={KIND_HINT[kind]}
              className="text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Note (optional)
            </Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="why it's noise"
              className="text-xs"
            />
          </div>
          <Button onClick={add} disabled={busy || !pattern.trim()} className="gap-1.5">
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Pattern</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length ? (
              rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="secondary">{r.kind}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-foreground">{r.pattern}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.note || '—'}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(r.id, r.pattern)}
                      disabled={busy}
                      aria-label="Delete suppression"
                    >
                      <Trash className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                  No suppression rules. The feed shows every event.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

'use client';

import { ShieldSlash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ScopeTarget {
  plane: string;
  label: string;
  execution: 'immediate' | 'deferred';
}

interface PropagationResult {
  target: string;
  label: string;
  outcome: 'erased' | 'deferred' | 'error';
  removed: number;
  reason: string | null;
}

// Text tint for a propagation outcome: erased → primary, error → destructive, else (deferred) → amber.
function propagationOutcomeClass(outcome: PropagationResult['outcome']): string {
  if (outcome === 'erased') return 'text-primary';
  if (outcome === 'error') return 'text-destructive';
  return 'text-amber-600';
}

// Right-to-be-forgotten form. Submits a subject; the route runs the console-plane erasure now,
// resolves the cross-plane scope, and records a durable request. Shows the resolved scope so the
// operator sees exactly what was erased vs. what waits on the warehouse data engine.
export function RtbfForm() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<ScopeTarget[] | null>(null);
  const [propagation, setPropagation] = useState<PropagationResult[] | null>(null);

  async function submit() {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/erasure-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject }),
      });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as {
        report?: { status?: string; erasedRows?: number };
        scope?: { targets?: ScopeTarget[]; immediateCount?: number; deferredCount?: number };
        propagation?: { propagated?: PropagationResult[]; deferred?: PropagationResult[] };
      };
      const rows = data.report?.erasedRows ?? 0;
      setScope(data.scope?.targets ?? []);
      const propagated = data.propagation?.propagated ?? [];
      const propDeferred = data.propagation?.deferred ?? [];
      setPropagation([...propagated, ...propDeferred]);
      toast.success(
        `Erasure recorded for ${subject} · ${rows} row${rows === 1 ? '' : 's'} erased now · ` +
          `${propagated.length} external target${propagated.length === 1 ? '' : 's'} propagated, ` +
          `${propDeferred.length} deferred.`,
      );
      setSubject('');
      router.refresh();
    } catch {
      toast.error('Failed to record erasure request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldSlash className="size-4 text-destructive" />
          Right to be forgotten
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Erase a data subject across every plane. The console erases what it owns immediately and
          propagates to the vector index and data lake now; device replicas get a durable tombstone
          they apply on next sync. Anything unreachable is honestly reported as deferred, never faked.
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs">Subject (email or id)</Label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="subject@customer.in"
          />
        </div>
        <Button onClick={submit} disabled={busy || !subject.trim()} variant="outline" className="w-full">
          {busy ? 'Erasing…' : 'Erase subject'}
        </Button>

        {propagation && propagation.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-3 text-xs">
            <div className="font-medium text-foreground">External-plane propagation</div>
            {propagation.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground">
                  <span className="uppercase text-foreground/70">{p.target}</span> · {p.label}
                  {p.outcome === 'erased' && p.removed > 0 ? ` (${p.removed})` : ''}
                </span>
                <span className={propagationOutcomeClass(p.outcome)} title={p.reason ?? undefined}>
                  {p.outcome === 'erased' ? 'propagated' : p.outcome}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {scope && scope.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-3 text-xs">
            <div className="font-medium text-foreground">Resolved scope</div>
            {scope.map((t, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground">
                  <span className="uppercase text-foreground/70">{t.plane}</span> · {t.label}
                </span>
                <span className={t.execution === 'immediate' ? 'text-primary' : 'text-amber-600'}>
                  {t.execution}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

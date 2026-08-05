'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ─── RetentionPanel — how long a bucket keeps what it stores ─────────────────────────────────────
//
// The adapter and the route for this existed and worked; there was no way for a person to reach
// them. Retention is a COMPLIANCE claim — "we do not keep this longer than N days" — and a claim
// only an engineer with curl can inspect is a claim nobody can audit.
//
// Written in days-to-keep rather than lifecycle vocabulary, because the person who has to answer for
// the retention period is a compliance officer, not the operator who set it.

interface Rule {
  id: string;
  prefix: string;
  expireDays: number;
  enabled: boolean;
}

interface State {
  supported: boolean;
  rules: Rule[];
  note?: string;
}

export function RetentionPanel({ bucket }: Readonly<{ bucket: string }>) {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [days, setDays] = useState('');
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState(false);

  const url = `/api/v1/admin/lake/buckets/${encodeURIComponent(bucket)}/lifecycle`;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`could not read the retention rules (${res.status})`);
      setState((await res.json()) as State);
    } catch (e) {
      // A FAILED READ IS NOT "no rules". Rendering an error as an empty list would tell a compliance
      // reader that nothing is deleted on a schedule, which is the opposite of unknown.
      setState(null);
      setLoadError((e as Error).message);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(rules: Rule[]) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      const j = (await res.json()) as State & { error?: string };
      if (!res.ok) throw new Error(j.error || `save failed (${res.status})`);
      if (!j.supported) throw new Error(j.note || 'this store did not accept the rule');
      // Render what the STORE came back with, not what we sent: it may rename or rewrite a rule, and
      // showing our own request would claim a state the store does not actually hold.
      setState(j);
      toast.success('Retention updated');
      setDays('');
      setPrefix('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const add = () => {
    const n = Math.floor(Number(days));
    if (!Number.isFinite(n) || n < 1) return toast.error('Enter a whole number of days, at least 1');
    void save([
      ...(state?.rules ?? []),
      { id: `expire-${prefix.trim() || 'all'}-${n}d`, prefix: prefix.trim(), expireDays: n, enabled: true },
    ]);
  };

  const remove = (id: string) => {
    if (!confirm('Stop deleting these objects on a schedule?')) return;
    void save((state?.rules ?? []).filter((r) => r.id !== id));
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">How long this bucket keeps things</CardTitle>
        <CardDescription className="text-xs">
          Objects are deleted automatically once they reach the age you set. Leave the folder blank to
          cover the whole bucket.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {loadError} — this is not the same as “nothing is deleted on a schedule”. The current rules
            are unknown until this reads successfully.
          </p>
        ) : null}

        {state && !state.supported ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {state.note ?? 'This object store does not support scheduled deletion.'} Anything kept here
            has to be removed by another process.
          </p>
        ) : null}

        {state?.supported ? (
          <>
            <div className="divide-y divide-border rounded-md border border-border">
              {state.rules.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {r.prefix ? `${r.prefix}` : 'Everything in this bucket'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Deleted {r.expireDays} day{r.expireDays === 1 ? '' : 's'} after it is written
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.enabled ? null : <Badge variant="secondary">paused</Badge>}
                    <button
                      onClick={() => remove(r.id)}
                      disabled={busy}
                      className="text-xs text-destructive hover:underline disabled:opacity-50"
                    >
                      remove
                    </button>
                  </div>
                </div>
              ))}
              {state.rules.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Nothing here is deleted on a schedule. It is kept until someone removes it.
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="retention-prefix" className="text-xs">
                  Folder (optional)
                </Label>
                <Input
                  id="retention-prefix"
                  value={prefix}
                  placeholder="exports/"
                  onChange={(e) => setPrefix(e.target.value)}
                  className="h-9 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="retention-days" className="text-xs">
                  Keep for (days)
                </Label>
                <Input
                  id="retention-days"
                  value={days}
                  inputMode="numeric"
                  placeholder="30"
                  onChange={(e) => setDays(e.target.value)}
                  className="h-9 w-28"
                />
              </div>
              <Button size="sm" onClick={add} disabled={busy || !days.trim()}>
                Add rule
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

'use client';

import { CheckCircle, Sparkle } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { explainResponse } from '@/lib/api-failure';
import type { SuggestedEval } from '@/lib/app-eval-suggest';

// ─── Checks derived from what this app DOES (ROADMAP §10 Flow 3) ───────────────────────────────────
//
// "OGAC generates the app and tests" / "generates or updates evaluations." Compiling a brief produced
// neither. These are derived from the app's own spec — a step that reads a domain implies the answer
// must be grounded in it; a human step implies the run must pause; an action implies nothing may be
// sent before its approval; a bound pipeline implies data outside the ceiling must be refused.
//
// Nothing is added without a person choosing it. A test nobody agreed to is one whose failures the
// team learns to ignore, which is worse than not having it.
export function SuggestedChecks({ appId, appTitle }: Readonly<{ appId: string; appTitle: string }>) {
  const router = useRouter();
  const [items, setItems] = useState<SuggestedEval[] | null>(null);
  const [covered, setCovered] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/apps/${appId}/evals/suggest`);
    if (!res.ok) {
      // A failed read must not render as "no checks to add" — that reads as "your app is fully covered".
      setError((await explainResponse(res, 'work out which checks this app needs')).message);
      setItems([]);
      return;
    }
    const body = await res.json();
    setItems(body.data ?? []);
    setCovered(body.alreadyCovered ?? 0);
    setChosen(new Set((body.data ?? []).map((s: SuggestedEval) => s.key)));
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    if (!chosen.size) return;
    setBusy(true);
    const res = await fetch(`/api/v1/admin/apps/${appId}/evals/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: [...chosen] }),
    });
    setBusy(false);
    if (res.ok) {
      const { created } = await res.json();
      toast.success(
        `Added ${created.length} check${created.length === 1 ? '' : 's'} to this app's evaluation set`,
      );
      await load();
      router.refresh();
      return;
    }
    const failure = await explainResponse(res, 'add these checks');
    (failure.refusal ? toast.info : toast.error)(failure.message);
  }

  if (items !== null && !items.length && !error) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <CheckCircle className="size-4 text-primary" /> Derived checks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {covered
              ? `Every check derived from ${appTitle}'s design is already in its evaluation set (${covered}).`
              : `This app's design implies no automatic checks yet — bind a data source, a human step or an action and they will appear here.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkle className="size-4 text-primary" /> Derived checks
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Each one asserts something this app&apos;s own design promises. Choose what you want
            measured — nothing is added on your behalf.
          </p>
        </div>
        <Button size="sm" onClick={accept} disabled={busy || !chosen.size} className="shrink-0">
          {busy ? 'Adding…' : `Add ${chosen.size || ''} to evaluations`.trim()}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            {error}
          </p>
        ) : items === null ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          items.map((s) => {
            const on = chosen.has(s.key);
            return (
              <label
                key={s.key}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${on ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.key)) next.delete(s.key);
                      else next.add(s.key);
                      return next;
                    })
                  }
                  className="mt-0.5 size-4 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{s.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{s.rationale}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    expects: {s.expected}
                  </p>
                </div>
              </label>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

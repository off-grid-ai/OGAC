'use client';

import { CheckCircle, Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { explainResponse } from '@/lib/api-failure';
import { RETAINABLE_CLASSES, classLabel, type RetentionRule, type SweepAction } from '@/lib/retention-sweep';
import { utcStamp } from '@/lib/timestamp';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm';

interface RunRecord {
  id: string;
  ranBy: string;
  ranAt: string;
  summary: string;
  complete: boolean;
  outcomes: { recordClass: string; action: string; affected: number; remaining: number; error?: string }[];
  skipped: { recordClass: string; reason: string }[];
}

// ─── Set the limit, run it, keep the proof ──────────────────────────────────────────────────────────
//
// A retention SETTING is not retention. This is the surface where the limit is set per record class,
// the sweep is run, and every sweep leaves a durable record with counts re-queried after the deletion
// — which is what "prove you delete data when you said you would" actually needs.
export function RetentionPanel({
  rules,
  runs,
}: Readonly<{ rules: RetentionRule[]; runs: RunRecord[] }>) {
  const [draft, setDraft] = useState<Record<string, { days: string; action: SweepAction; hold: boolean }>>(
    Object.fromEntries(
      RETAINABLE_CLASSES.map((c) => {
        const r = rules.find((x) => x.recordClass === c.id);
        return [
          c.id,
          {
            days: r ? String(r.retainDays) : '0',
            action: (r?.action ?? 'redact') as SweepAction,
            hold: Boolean(r?.legalHold),
          },
        ];
      }),
    ),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [latest, setLatest] = useState<RunRecord | null>(runs[0] ?? null);

  async function saveRule(recordClass: string) {
    const d = draft[recordClass];
    setBusy(recordClass);
    const res = await fetch('/api/v1/admin/retention', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recordClass,
        retainDays: Number(d.days),
        action: d.action,
        legalHold: d.hold,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const f = await explainResponse(res, 'save this retention limit');
      (f.refusal ? toast.info : toast.error)(f.message);
      return;
    }
    toast.success(`${classLabel(recordClass)} — limit saved`);
  }

  async function sweep() {
    setBusy('sweep');
    const res = await fetch('/api/v1/admin/retention', { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      const f = await explainResponse(res, 'run the retention sweep');
      (f.refusal ? toast.info : toast.error)(f.message);
      return;
    }
    const data = (await res.json()) as { run?: RunRecord };
    if (data.run) setLatest(data.run);
    toast[data.run?.complete ? 'success' : 'warning'](
      data.run?.complete ? 'Retention applied' : 'Retention ran, but did not finish',
    );
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          {/* The action sits beside the title, not stretched across the card — a full-width green bar
              reads as a banner, not a button you are meant to consider before pressing. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm">How long records are kept</CardTitle>
            <Button
              onClick={sweep}
              disabled={busy !== null}
              size="sm"
              className="w-auto shrink-0 gap-1.5 self-start"
            >
              <Play className="size-4" />
              {busy === 'sweep' ? 'Applying…' : 'Apply retention now'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          {RETAINABLE_CLASSES.map((c) => {
            const d = draft[c.id];
            return (
              <div key={c.id} className="space-y-2 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{c.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{c.detail}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`days-${c.id}`} className="text-xs">
                    Keep for
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`days-${c.id}`}
                      value={d.days}
                      inputMode="numeric"
                      onChange={(e) =>
                        setDraft((s) => ({ ...s, [c.id]: { ...s[c.id], days: e.target.value } }))
                      }
                      className="h-9"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">days</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {Number(d.days) > 0
                      ? `Anything older than ${d.days} days is ${d.action === 'redact' ? 'stripped of its content' : 'deleted'}.`
                      : 'Zero means kept forever — an explicit choice, and it is reported as one.'}
                  </p>
                </div>
                {c.id !== 'knowledge_chunks' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`action-${c.id}`} className="text-xs">
                      When the time is up
                    </Label>
                    <select
                      id={`action-${c.id}`}
                      value={d.action}
                      onChange={(e) =>
                        setDraft((s) => ({
                          ...s,
                          [c.id]: { ...s[c.id], action: e.target.value as SweepAction },
                        }))
                      }
                      className={SELECT}
                    >
                      <option value="redact">
                        Remove the content, keep the record — the decision trail survives
                      </option>
                      <option value="delete">Delete the record entirely</option>
                    </select>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Indexed text is always deleted — a chunk with its text stripped would still be
                    returned by search as an empty source.
                  </p>
                )}
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={d.hold}
                    onChange={(e) =>
                      setDraft((s) => ({ ...s, [c.id]: { ...s[c.id], hold: e.target.checked } }))
                    }
                  />
                  Legal hold — suspend deletion
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveRule(c.id)}
                  disabled={busy !== null}
                  className="w-full"
                >
                  {busy === c.id ? 'Saving…' : 'Save limit'}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* THE EVIDENCE. Counts are re-queried after the deletion, so this proves it rather than asserting it. */}
      {latest ? (
        <Card
          className={
            latest.complete ? 'border-primary/40 shadow-sm' : 'border-amber-500/40 shadow-sm'
          }
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              {latest.complete ? (
                <CheckCircle className="size-4 text-primary" weight="fill" />
              ) : (
                <Warning className="size-4 text-amber-600" weight="fill" />
              )}
              {/* Explicit UTC, not toLocaleString: this renders on the server and again in the browser
                  and the two resolve locale AND zone from their own environment. It also has to be
                  readable AS EVIDENCE — "8/4/2026, 8:28:04 AM" does not say which zone that is. */}
              Last applied {utcStamp(latest.ranAt, { precision: 'seconds' })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="text-foreground">{latest.summary}</p>
            <p className="text-muted-foreground">
              {latest.ranBy ? `Run by ${latest.ranBy}.` : 'Operator not recorded.'}
            </p>
            <ul className="space-y-1">
              {latest.outcomes.map((o) => (
                <li
                  key={o.recordClass}
                  className={o.error || o.remaining > 0 ? 'text-amber-700 dark:text-amber-500' : 'text-muted-foreground'}
                >
                  · <span className="font-medium text-foreground">{classLabel(o.recordClass)}</span> —{' '}
                  {o.affected.toLocaleString()} {o.action === 'redact' ? 'stripped' : 'deleted'}
                  {o.error
                    ? ` · FAILED: ${o.error}`
                    : o.remaining > 0
                      ? ` · ${o.remaining} still past the limit — not finished`
                      : ' · nothing past the limit remains'}
                </li>
              ))}
            </ul>
            {latest.skipped.length ? (
              <ul className="space-y-1 border-t border-border pt-2">
                {latest.skipped.map((s) => (
                  <li key={s.recordClass} className="text-muted-foreground">
                    · <span className="text-foreground">{classLabel(s.recordClass)}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/40 shadow-sm">
          <CardContent className="py-4">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Retention has never been applied. Limits above are only a setting until a sweep runs —
              this says so rather than showing a limit and implying it is being honoured.
            </p>
          </CardContent>
        </Card>
      )}

      {runs.length > 1 ? (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Earlier sweeps</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {runs.slice(1).map((r) => (
                <li key={r.id} className="text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {new Date(r.ranAt).toLocaleDateString()}
                  </span>{' '}
                  — {r.summary}
                  {r.complete ? '' : ' · did not finish'}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

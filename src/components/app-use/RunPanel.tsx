'use client';

import { CheckCircle, EnvelopeSimple, Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CasePicker } from '@/components/build/CasePicker';
import { Label } from '@/components/ui/label';
import type { AppSurface } from '@/lib/app-surface';

// The minimal field shape this panel renders. Mirrors lib/app-model FormField (kept structural so the
// panel doesn't couple to the model module) — text | number | select | date | textarea, with help.
export interface RunField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'textarea';
  required?: boolean;
  options?: string[];
  description?: string;
  placeholder?: string;
}

interface RunResult {
  status?: string;
  output?: string;
  outcome?: string;
  error?: string;
}

export function RunPanel({
  fields,
  surface,
  appId,
}: Readonly<{
  fields: RunField[];
  surface: AppSurface;
  /** The app, so a case can be PICKED from its bound data instead of typed. */
  appId?: string;
}>) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => f.type === 'select' && f.options?.[0]).map((f) => [f.key, ''])),
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // The single free-text field is the fallback shape. When that is what we have, offer the org's own records
  // FIRST — this is the surface a team actually opens, so it matters more here than in the console.
  const offerPicker = Boolean(appId) && fields.length === 1 && fields[0]?.key === 'input';
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());

  async function run() {
    if (running || missing.length > 0) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(surface.runUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: values }),
      });
      const data = (await res.json()) as RunResult;
      setResult(data);
      if (data.status === 'error' || data.error) toast.error('The run hit an error — see below.');
      else toast.success('Run complete.');
    } catch {
      setResult({ error: 'The app is unreachable — try again.' });
      toast.error('Run failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="shadow-sm lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Start a case</CardTitle>
          <p className="text-xs text-muted-foreground">
            Fill in what this run needs — every run goes through the governed pipeline.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {offerPicker && appId ? (
              <div className="space-y-2">
                <CasePicker
                  appId={appId}
                  selectedId={pickedId}
                  onPick={(candidate) => {
                    setPickedId(candidate.id);
                    // The whole record goes to the run; the readable label is only the case subject.
                    setValues((v) => ({
                      ...v,
                      input: [candidate.label, candidate.detail].filter(Boolean).join(' · '),
                      case_record: JSON.stringify(candidate.record),
                    }));
                  }}
                />
                <p className="text-xs text-muted-foreground">Or describe one by hand below.</p>
              </div>
            ) : null}
            {fields.map((f) => (
              <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <Label className="text-xs text-muted-foreground">
                  {f.label}
                  {f.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                {f.description ? (
                  <p className="mb-1.5 mt-0.5 text-[11px] text-muted-foreground/70">{f.description}</p>
                ) : (
                  <div className="mb-1.5" />
                )}
                {f.type === 'select' && f.options?.length ? (
                  <select
                    value={values[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-2.5 text-sm"
                  >
                    <option value="">— choose —</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea
                    value={values[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    rows={3}
                    className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm"
                  />
                ) : (
                  <Input
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={run} disabled={running || missing.length > 0} className="gap-1.5">
              <Play className="size-4" weight="fill" />
              {running ? 'Running…' : 'Run'}
            </Button>
          </div>

          {result ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-2">
                {result.error || result.status === 'error' ? (
                  <Warning className="size-4 text-destructive" />
                ) : (
                  <CheckCircle className="size-4 text-primary" />
                )}
                <span className="text-xs font-medium text-foreground">Result</span>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-foreground">
                {result.outcome || result.output || result.error || '(no output)'}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <SendReportCard surface={surface} />
    </div>
  );
}

function SendReportCard({ surface }: Readonly<{ surface: AppSurface }>) {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    if (sending || !to.trim()) return;
    setSending(true);
    try {
      const res = await fetch(surface.sendReportUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; configured?: boolean; reason?: string };
      if (data.ok) toast.success(`Report sent to ${to.trim()}`);
      else if (data.configured === false) toast.info('Email is not configured on this deployment yet.');
      else toast.error(data.reason || 'Could not send the report.');
    } catch {
      toast.error('Could not send the report.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="h-fit shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <EnvelopeSimple size={16} className="shrink-0 text-primary" weight="duotone" />
          <span>Send report now</span>
        </CardTitle>
        {/* Was "Email this cockpit as a governed report. It also goes out weekly on Monday 9:00 IST." —
          cross-sell cockpit copy, shown on EVERY app. A reimbursement app told a clerk about a Monday
          9:00 IST cockpit digest that does not exist for it. Nothing here may assume one app. */}
        <CardDescription className="text-xs">
          Email these results as a governed report. PII is masked before it leaves.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground">Recipient</Label>
          <Input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@yourcompany.com"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Note (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" className="mt-1" />
        </div>
        <Button onClick={send} disabled={sending || !to.trim()} variant="outline" className="w-full gap-1.5">
          <EnvelopeSimple className="size-4" />
          {sending ? 'Sending…' : 'Send report'}
        </Button>
        <Badge variant="secondary" className="w-full justify-center bg-primary/5 text-[10px] text-primary/80">
          ✓ PII masked · egress governed
        </Badge>
      </CardContent>
    </Card>
  );
}

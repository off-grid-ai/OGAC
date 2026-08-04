'use client';

import { CheckCircle, EnvelopeSimple, Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CasePicker } from '@/components/build/CasePicker';
import { progressHeadline, type RunProgressStep } from '@/lib/app-run-progress';
import { statusLabel } from '@/lib/app-work-queue';
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
  runId?: string;
  /** The governed trail behind the answer, so a result never arrives without its provenance. */
  trail?: string | null;
  /** Which step is underway — so a minute-long governed run reads as working, not stuck. */
  progress?: RunProgressStep[];
}

/** Statuses that will not change again — polling stops here. */
const TERMINAL = new Set(['done', 'error', 'cancelled', 'awaiting_human']);

export function RunPanel({
  fields,
  surface,
  appId,
  heading = 'Start a case',
}: Readonly<{
  fields: RunField[];
  surface: AppSurface;
  /** The app, so a case can be PICKED from its bound data instead of typed. */
  appId?: string;
  /**
   * The panel's own title, or null to suppress it.
   *
   * A job's front door already heads this section "Run it now"; leaving the card's own "Start a case"
   * inside it stacks two headings on one control, and "case" is the wrong noun for a shape where
   * nothing queues.
   */
  heading?: string | null;
}>) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => f.type === 'select' && f.options?.[0]).map((f) => [f.key, ''])),
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // The picked record is kept as a RECORD, not flattened into the text form: the run's data steps filter
  // on its fields (`{{case.employee_id}}`), so squeezing it through a string form would lose exactly the
  // structure they need.
  const [pickedRecord, setPickedRecord] = useState<Record<string, unknown> | null>(null);
  // The single free-text field is the fallback shape. When that is what we have, offer the org's own records
  // FIRST — this is the surface a team actually opens, so it matters more here than in the console.
  const offerPicker = Boolean(appId) && fields.length === 1 && fields[0]?.key === 'input';
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());

  /**
   * Follow a run until it settles, updating the result in place.
   *
   * Bounded rather than indefinite: a run that has not settled inside the window is reported as still working
   * with a pointer to Activity — the honest answer — instead of spinning forever or falsely claiming failure.
   */
  async function pollToOutcome(runId: string, started: RunResult) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      try {
        const res = await fetch(`${surface.runStatusBase}${encodeURIComponent(runId)}`);
        if (!res.ok) break; // no status endpoint or no access — fall back to what the run already told us
        const next = (await res.json()) as RunResult;
        setResult({ ...started, ...next });
        if (TERMINAL.has(String(next.status))) {
          if (next.status === 'error') toast.error('The run hit an error — see below.');
          else if (next.status === 'awaiting_human') toast.success('Needs a decision.');
          else toast.success('Done.');
          return;
        }
      } catch {
        break;
      }
    }
  }

  async function run() {
    if (running || missing.length > 0) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(surface.runUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pickedRecord ? { input: values, case: pickedRecord } : { input: values }),
      });
      const data = (await res.json().catch(() => ({}))) as RunResult & { error?: string };

      // The response STATUS was previously ignored, so a refused run fell through to the body renderer and
      // displayed "(no output)" — the app looked broken when it was working exactly as governed.
      if (!res.ok) {
        setResult({
          error:
            res.status === 403
              ? 'You have view-only access to this app, so it cannot be run from here. Everything else on this page is live.'
              : (data.error ?? `The run was refused (${res.status}).`),
        });
        toast.error(res.status === 403 ? 'View-only access' : 'The run was refused');
        return;
      }

      setResult(data);
      if (data.status === 'error' || data.error) {
        toast.error('The run hit an error — see below.');
      } else if (TERMINAL.has(String(data.status))) {
        toast.success(data.status === 'awaiting_human' ? 'Started — it now needs a decision.' : 'Run complete.');
      } else if (data.runId) {
        // POLL to the answer. "It is running, look under Activity" made the person do the work and then go
        // hunting for the result. Value has to arrive where they are standing.
        toast.success('Started — working on it.');
        await pollToOutcome(data.runId, data);
      } else {
        toast.success('Started.');
      }
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
        {heading ? (
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{heading}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {/* Not "the governed pipeline". A department reader does not know what a pipeline is, and
                  the promise they care about is the outcome: it is checked, and it is written down. */}
              Fill in what this run needs — every run is checked against your rules and recorded.
            </p>
          </CardHeader>
        ) : null}
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
                    // `case` is the canonical field — the run's steps filter their data reads on it
                    // (`{{case.employee_id}}`), so it has to arrive as the record, not as prose.
                    setPickedRecord(candidate.record);
                    setValues((v) => ({
                      ...v,
                      input: [candidate.label, candidate.detail].filter(Boolean).join(' · '),
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
                <span className="text-xs font-medium text-foreground">
                  {result.progress?.some((step) => step.state === 'running')
                    ? progressHeadline(result.progress)
                    : 'Result'}
                </span>
              </div>
              {/* The steps of the run, in the app's own words. Visible from the first second — the shape of
                the work should not materialise line by line while someone waits. */}
              {result.progress?.length ? (
                <ol className="mb-2 space-y-1">
                  {result.progress.map((step, index) => (
                    <li
                      key={`${index}-${step.label}`}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <ProgressMark state={step.state} />
                      <span className={step.state === 'pending' ? 'opacity-60' : 'text-foreground'}>
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {/* NEVER "(no output)". A run that produced no text still did something, and saying nothing
                makes a working app look broken. A run paused for a person is the NORMAL outcome for an app
                with a human step — it belongs in Work now, and the reader needs telling. */}
              <pre className="whitespace-pre-wrap text-sm text-foreground">
                {result.outcome ||
                  result.output ||
                  result.error ||
                  (result.status === 'awaiting_human'
                    ? 'Started. This case now needs a decision — it is waiting for you under Work.'
                    : result.status === 'queued' || result.status === 'running'
                      ? 'Started. It is running now; the result will appear under Activity.'
                      : result.status
                        // statusLabel, not the raw status. This printed Finished with status "done" —
                        // an internal token in a sentence aimed at someone who has never seen one.
                        ? `${statusLabel(result.status)} — no text was produced. See Activity for the step-by-step trail.`
                        : 'Started. See Activity for the step-by-step trail.')}
              </pre>
              {/* The provenance arrives WITH the answer, not on another screen. */}
              {result.trail ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{result.trail}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <SendReportCard surface={surface} />
    </div>
  );
}

/** One step's state, as a mark a person can read at a glance rather than a colour alone. */
function ProgressMark({ state }: Readonly<{ state: RunProgressStep['state'] }>) {
  if (state === 'done') return <CheckCircle className="size-3.5 shrink-0 text-primary" />;
  if (state === 'failed') return <Warning className="size-3.5 shrink-0 text-destructive" />;
  if (state === 'waiting') return <span className="w-3.5 shrink-0 text-center text-primary">!</span>;
  if (state === 'running') {
    return (
      <span className="size-3.5 shrink-0 animate-pulse rounded-full border-2 border-primary bg-primary/30" />
    );
  }
  return <span className="size-3.5 shrink-0 rounded-full border border-border" />;
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

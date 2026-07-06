'use client';

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FloppyDisk,
  Plus,
  Sparkle,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { OrgContextSummary } from '@/lib/org-context';
import {
  type AppSpec,
  type AppStepKind,
  type TriggerKind,
  validateAppSpec,
} from '@/lib/app-model';
import {
  addStep,
  moveStep,
  rebindAgent,
  rebindDomain,
  relabelStep,
  removeStep,
  setAgentPrompt,
  setOutputSink,
  setSummary,
  setTitle,
  setTrigger,
  setVisibility,
  toggleGrounding,
  type BindingNames,
} from '@/lib/app-builder';
import { AppStepEditor, type StepEditorHandlers } from '@/components/build/AppStepEditor';
import { InheritanceBanner } from '@/components/build/InheritanceBanner';

// ─── AppBuilder (Builder Epic Phase 3A) — the full-screen guided BUILD screen ─────────────────────
//
// Founder's vision: "create a new agent should be a screen of its own, with a lot of help, very easy
// to make an agent." A non-technical dept head types a plain-language process → the NL compiler
// (/api/v1/admin/apps/compile) carves an ordered step skeleton → they refine it via text/dropdowns
// (this is the TEXT half of the dual-mode builder; the canvas is Phase 3B) → save → route to the
// app's INPUT screen to run it.
//
// The two navigational positions live in the URL (?phase=describe|refine) so Back walks the flow and
// each phase is deep-linkable. The AppSpec being edited is CONTENT (component state); all edits go
// through the pure reducers in app-builder.ts. Nothing here re-implements a graph rule — validity
// comes from validateAppSpec.

type Phase = 'describe' | 'refine';

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: 'Reimbursement approval',
    text: 'Reimbursement approval — read the invoice, check the employee\'s reimbursement quota, decide if they\'ve exceeded it and are eligible, then have a manager approve or reject.',
  },
  {
    label: 'Support triage',
    text: 'Read the customer\'s recent tickets, classify the issue and its urgency, draft a reply grounded in our policies, then email it.',
  },
  {
    label: 'Simple assistant',
    text: 'Answer employee questions about our HR policies and always cite the policy document you used.',
  },
];

const STEP_KINDS: { kind: AppStepKind; label: string }[] = [
  { kind: 'connector-query', label: 'Read data' },
  { kind: 'agent', label: 'Agent step' },
  { kind: 'guardrail', label: 'Guardrail' },
  { kind: 'human', label: 'Human review' },
  { kind: 'output', label: 'Output' },
];

const TRIGGERS: { kind: TriggerKind; label: string; hint: string }[] = [
  { kind: 'on-demand', label: 'On demand', hint: 'A person runs it from a form' },
  { kind: 'webhook', label: 'Webhook', hint: 'An inbound HTTP call starts a run' },
  { kind: 'schedule', label: 'Schedule', hint: 'Runs on a recurring cron' },
  { kind: 'email', label: 'Email', hint: 'An incoming email starts a run (on-prem)' },
];

const VISIBILITY: { id: AppSpec['visibility']; label: string; hint: string }[] = [
  { id: 'private', label: 'Just me', hint: 'Only you can run it' },
  { id: 'org', label: 'My org', hint: 'Everyone in the org can find and run it' },
  { id: 'public', label: 'Shareable link', hint: 'Publishes a direct link when you publish' },
];

export function AppBuilder({
  summary,
  domains,
  agents,
}: {
  summary: OrgContextSummary;
  domains: { id: string; label: string }[];
  agents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const rawPhase = params.get('phase');
  const phase: Phase = rawPhase === 'refine' ? 'refine' : 'describe';
  const goToPhase = useCallback(
    (p: Phase) => {
      const next = new URLSearchParams(params.toString());
      next.set('phase', p);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const [description, setDescription] = useState('');
  const [spec, setSpec] = useState<AppSpec | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [compiling, setCompiling] = useState(false);
  const [saving, setSaving] = useState(false);

  const names: BindingNames = useMemo(() => ({ domains, agents }), [domains, agents]);
  const validation = useMemo(() => (spec ? validateAppSpec(spec) : null), [spec]);

  // Compile the plain-language description → an AppSpec skeleton + honest gaps.
  async function compile() {
    if (description.trim().length < 8 || compiling) return;
    setCompiling(true);
    try {
      const res = await fetch('/api/v1/admin/apps/compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error('Could not compile the description');
      const data = (await res.json()) as { spec: AppSpec; gaps: string[] };
      setSpec(data.spec);
      setGaps(data.gaps ?? []);
      goToPhase('refine');
      toast.success('Carved a step skeleton — refine it below, then save.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Compile failed');
    } finally {
      setCompiling(false);
    }
  }

  // Save the refined spec → route to the saved app's INPUT screen.
  async function save() {
    if (!spec || saving) return;
    const check = validateAppSpec(spec);
    if (!check.ok) {
      toast.error(check.errors[0] ?? 'Fix the flagged steps first');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: spec.title,
          summary: spec.summary,
          visibility: spec.visibility,
          trigger: spec.trigger,
          inputForm: spec.inputForm,
          steps: spec.steps,
          edges: spec.edges,
        }),
      });
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
        throw new Error(body.errors?.[0] ?? 'The app spec did not validate');
      }
      if (!res.ok) throw new Error('Could not save the app');
      const app = (await res.json()) as { id: string };
      toast.success(`"${spec.title}" saved`);
      router.push(`/studio/new/${app.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Per-step edit handlers — each wraps a pure reducer + setSpec.
  function handlersFor(stepId: string): StepEditorHandlers {
    return {
      onRelabel: (label) => setSpec((s) => (s ? relabelStep(s, stepId, label) : s)),
      onMoveUp: () => setSpec((s) => (s ? moveStep(s, stepId, -1) : s)),
      onMoveDown: () => setSpec((s) => (s ? moveStep(s, stepId, 1) : s)),
      onRemove: () => setSpec((s) => (s ? removeStep(s, stepId) : s)),
      onRebindDomain: (d) => setSpec((s) => (s ? rebindDomain(s, stepId, d) : s)),
      onRebindAgent: (a) => setSpec((s) => (s ? rebindAgent(s, stepId, a) : s)),
      onSetPrompt: (p) => setSpec((s) => (s ? setAgentPrompt(s, stepId, p) : s)),
      onToggleGrounding: (g) => setSpec((s) => (s ? toggleGrounding(s, stepId, g) : s)),
      onSetSink: (sink) => setSpec((s) => (s ? setOutputSink(s, stepId, sink) : s)),
    };
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <InheritanceBanner summary={summary} />

      {phase === 'describe' ? (
        <DescribePhase
          description={description}
          setDescription={setDescription}
          compiling={compiling}
          onCompile={compile}
        />
      ) : null}

      {phase === 'refine' && spec ? (
        <div className="space-y-5">
          {/* App identity */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Name &amp; describe your app</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input
                  value={spec.title}
                  onChange={(e) => setSpec((s) => (s ? setTitle(s, e.target.value) : s))}
                  placeholder="Reimbursement approval"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Summary</Label>
                <Textarea
                  value={spec.summary}
                  onChange={(e) => setSpec((s) => (s ? setSummary(s, e.target.value) : s))}
                  rows={2}
                  placeholder="What this app does, in a sentence."
                  className="text-sm"
                />
              </div>
            </CardContent>
          </Card>

          {gaps.length > 0 ? <GapsPanel gaps={gaps} /> : null}

          {/* The step skeleton */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">The steps</CardTitle>
              <p className="text-xs text-muted-foreground">
                This is the process we carved from your description. Reorder, relabel, rebind a data
                source or agent, or add and remove steps. Each step runs governed.
              </p>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {spec.steps.map((step, i) => (
                <AppStepEditor
                  key={step.id}
                  step={step}
                  index={i}
                  total={spec.steps.length}
                  names={names}
                  handlers={handlersFor(step.id)}
                />
              ))}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-muted-foreground">Add a step:</span>
                {STEP_KINDS.map((k) => (
                  <Button
                    key={k.kind}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setSpec((s) => (s ? addStep(s, k.kind) : s))}
                  >
                    <Plus className="size-3" />
                    {k.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Trigger + visibility */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">How is it triggered?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {TRIGGERS.map((t) => (
                  <SelectRow
                    key={t.kind}
                    active={spec.trigger.kind === t.kind}
                    label={t.label}
                    hint={t.hint}
                    onClick={() => setSpec((s) => (s ? setTrigger(s, t.kind) : s))}
                  />
                ))}
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Who can use it?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {VISIBILITY.map((v) => (
                  <SelectRow
                    key={v.id}
                    active={spec.visibility === v.id}
                    label={v.label}
                    hint={v.hint}
                    onClick={() => setSpec((s) => (s ? setVisibility(s, v.id) : s))}
                  />
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Save bar */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button variant="ghost" size="sm" onClick={() => goToPhase('describe')} className="gap-1.5">
              <ArrowLeft className="size-4" />
              Back to describe
            </Button>
            <div className="flex items-center gap-3">
              {validation && !validation.ok ? (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                  <Warning className="size-3.5" />
                  {validation.errors[0]}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CheckCircle className="size-3.5 text-primary" />
                  Looks good
                </span>
              )}
              <Button onClick={save} disabled={saving || !validation?.ok} className="gap-1.5">
                <FloppyDisk className="size-4" />
                {saving ? 'Saving…' : 'Save app'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DescribePhase({
  description,
  setDescription,
  compiling,
  onCompile,
}: {
  description: string;
  setDescription: (v: string) => void;
  compiling: boolean;
  onCompile: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Describe what this app should do</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Write it in plain language — the outcome you want and the steps it should take. We turn it
          into a governed, runnable app. An agent is just the simplest app: one step.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="space-y-3 py-4">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            placeholder="e.g. Reimbursement approval — read the invoice, check the employee's quota, decide if they're eligible, then have a manager approve or reject."
            className="text-sm"
          />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              We only bind steps to data sources your org has declared — never a fabricated one.
            </p>
            <Button onClick={onCompile} disabled={description.trim().length < 8 || compiling} className="gap-1.5">
              <Sparkle className="size-4" />
              {compiling ? 'Carving steps…' : 'Build the steps'}
              {!compiling ? <ArrowRight className="size-4" /> : null}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground/70">
          Or start from an example
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => setDescription(ex.text)}
              className="rounded-md border border-border p-3 text-left hover:border-primary/40"
            >
              <div className="text-sm font-medium text-foreground">{ex.label}</div>
              <div className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground">{ex.text}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GapsPanel({ gaps }: { gaps: string[] }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
      <div className="flex items-center gap-1.5">
        <Warning className="size-4 text-amber-600 dark:text-amber-500" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
          {gaps.length} thing{gaps.length === 1 ? '' : 's'} to resolve
        </span>
      </div>
      <ul className="mt-1.5 space-y-1 text-[11px] text-amber-800 dark:text-amber-300/90">
        {gaps.map((g, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden>•</span>
            <span>{g}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SelectRow({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'flex w-full items-center justify-between rounded-md border border-primary bg-primary/5 px-3 py-2 text-left'
          : 'flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:border-primary/40'
      }
    >
      <div>
        <div className="text-sm text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      {active ? (
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          selected
        </Badge>
      ) : null}
    </button>
  );
}

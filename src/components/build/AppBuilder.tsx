'use client';

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Database,
  FloppyDisk,
  Info,
  ListChecks,
  PencilSimple,
  Plus,
  Sparkle,
  TreeStructure,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
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
import {
  analyzeGaps,
  analyzeSpec,
  blockerCount,
  mergeFixIts,
  type FixIt,
} from '@/lib/builder-gaps';
import { AppStepEditor, type StepEditorHandlers } from '@/components/build/AppStepEditor';
import { InheritanceBanner } from '@/components/build/InheritanceBanner';
import { StudioCanvas } from '@/components/studio/StudioCanvas';
import {
  DomainFormPanel,
  type ConnectorOption,
} from '@/components/data-domains/DomainFormPanel';

// ─── AppBuilder (Builder Epic #115) — the USABLE guided BUILD screen ──────────────────────────────
//
// The founder's #1 frustration: the builder was powerful but baffling ("even IDK how to use it").
// The fix, per the brief:
//   • The GUIDED walk-through leads (describe → steps). The visual canvas is an ADVANCED toggle, not
//     the front door.
//   • After compile, the "N things to resolve" warnings are PROMINENT inline FIX-IT ACTIONS: a
//     missing data source renders a "Wire a data source" button that opens a data-domain create
//     panel RIGHT HERE (reuses DomainFormPanel → POST /api/v1/admin/data-domains). A step that needs
//     an agent/instructions gets a "Fix this step" button that scrolls to + highlights it. The
//     operator resolves everything without leaving.
//   • A one-line "how this works" helper per phase (the founder literally didn't know how to use it).
//
// The two builder positions live in the URL (?phase=describe|refine, ?view=guided|visual) so Back
// walks the flow and each is deep-linkable. The AppSpec is CONTENT (component state); all edits go
// through the pure reducers (app-builder.ts); all validity comes from validateAppSpec + the pure
// fix-it analysis (builder-gaps.ts) — this component re-implements no rule. It supports two entries:
// a NEW app (no initialApp → describe phase) and EDITING a saved app (initialApp → refine phase, and
// Save PATCHes instead of POSTs).

type Phase = 'describe' | 'refine';
type View = 'guided' | 'visual';

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
  domains: initialDomains,
  agents,
  connectors = [],
  initialApp,
}: {
  summary: OrgContextSummary;
  domains: { id: string; label: string }[];
  agents: { id: string; name: string }[];
  connectors?: ConnectorOption[];
  /** When present, the builder EDITS a saved app: it opens in refine, and Save PATCHes it. */
  initialApp?: AppSpec;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const editing = !!initialApp;

  const rawPhase = params.get('phase');
  const phase: Phase = editing || rawPhase === 'refine' ? 'refine' : 'describe';
  const view: View = params.get('view') === 'visual' ? 'visual' : 'guided';

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(key, value);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const [description, setDescription] = useState('');
  const [spec, setSpec] = useState<AppSpec | null>(initialApp ?? null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [compiling, setCompiling] = useState(false);
  const [saving, setSaving] = useState(false);

  // Data domains are refetchable: creating one inline via the fix-it panel must repopulate the
  // picker without a full navigation. Seeded from the server, refreshed after an inline create.
  const [domains, setDomains] = useState(initialDomains);
  // The step to visually highlight after a "fix this step" jump.
  const [highlightStep, setHighlightStep] = useState<string | null>(null);
  // The wire-data-source panel: which phrase prefills the label (null = closed).
  const [wirePhrase, setWirePhrase] = useState<string | null>(null);

  const names: BindingNames = useMemo(() => ({ domains, agents }), [domains, agents]);
  const validation = useMemo(() => (spec ? validateAppSpec(spec) : null), [spec]);

  // The single fix-it list: compiler gaps (phrase-based) + live spec analysis (step-based), merged.
  const fixIts = useMemo(
    () => mergeFixIts(analyzeGaps(gaps), analyzeSpec(spec)),
    [gaps, spec],
  );
  const blockers = blockerCount(fixIts);

  const refreshDomains = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/data-domains', { cache: 'no-store' });
      if (!res.ok) return;
      const { data } = (await res.json()) as {
        data: { id: string; label: string; connectorId?: string; resource?: string }[];
      };
      setDomains(
        data
          .filter((d) => d.connectorId && d.resource)
          .map((d) => ({ id: d.id, label: d.label })),
      );
    } catch {
      /* transient; picker keeps last-known domains */
    }
  }, []);

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
      setParam('phase', 'refine');
      toast.success('Carved a step skeleton — resolve anything flagged, then save.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Compile failed');
    } finally {
      setCompiling(false);
    }
  }

  // Save the refined spec → route to the saved app's own surface (Build tab).
  async function save() {
    if (!spec || saving) return;
    const check = validateAppSpec(spec);
    if (!check.ok) {
      toast.error(check.errors[0] ?? 'Resolve the flagged steps first');
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/v1/admin/apps/${spec.id}` : '/api/v1/admin/apps';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
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
        throw new Error(body.errors?.[0] ?? 'The app did not validate');
      }
      if (!res.ok) throw new Error('Could not save the app');
      const app = (await res.json()) as { id: string };
      toast.success(`"${spec.title}" saved`);
      if (editing) router.refresh();
      else router.push(`/apps/${app.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Act on a fix-it: data-source gaps open the inline create panel; step gaps scroll to + highlight
  // the step so its own binding editor is right there.
  function actOnFixIt(f: FixIt) {
    if (f.action === 'wire-data-source') {
      setWirePhrase(f.phrase ?? '');
      return;
    }
    if (f.stepId) jumpToStep(f.stepId);
  }

  function jumpToStep(stepId: string) {
    // Switch to guided view (the canvas has its own node selection) so the step editor is visible.
    if (view !== 'guided') setParam('view', 'guided');
    setHighlightStep(stepId);
    requestAnimationFrame(() => {
      document
        .getElementById(`step-${stepId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    window.setTimeout(() => setHighlightStep(null), 2200);
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
    <div className="w-full space-y-5">
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
          {/* How-this-works helper + guided/visual toggle */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <HowThisWorks
              text={
                view === 'guided'
                  ? 'Each row is a step your app runs, top to bottom. Fill in anything flagged below, then Save. Governance (policy, guardrails, grounding) is applied for you.'
                  : 'Drag to reorder, click a node to edit it, and connect steps. The canvas edits the same app — switch back to Guided anytime.'
              }
            />
            <ViewToggle view={view} onChange={(v) => setParam('view', v)} />
          </div>

          {/* THE FIX-IT PANEL — the founder's usability bar: warnings become one-click actions. */}
          {fixIts.length > 0 ? (
            <FixItPanel items={fixIts} onAct={actOnFixIt} />
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/[0.05] px-3 py-2 text-xs text-primary">
              <CheckCircle className="size-4" weight="fill" />
              Everything is wired. You&apos;re ready to save.
            </div>
          )}

          {view === 'guided' ? (
            <GuidedRefine
              spec={spec}
              names={names}
              highlightStep={highlightStep}
              handlersFor={handlersFor}
              onSpec={setSpec}
            />
          ) : (
            <Card className="shadow-sm">
              <CardContent className="p-3">
                <StudioCanvas
                  domains={domains}
                  agents={agents}
                  initialSpec={spec}
                  onSpecChange={(next) => setSpec(next)}
                />
              </CardContent>
            </Card>
          )}

          {/* Save bar */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            {editing ? (
              <span className="text-xs text-muted-foreground">Editing {spec.title}</span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setParam('phase', 'describe')}
                className="gap-1.5"
              >
                <ArrowLeft className="size-4" />
                Back to describe
              </Button>
            )}
            <div className="flex items-center gap-3">
              {blockers > 0 ? (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                  <Warning className="size-3.5" />
                  {blockers} thing{blockers === 1 ? '' : 's'} to resolve first
                </span>
              ) : validation && !validation.ok ? (
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
              <Button
                onClick={save}
                disabled={saving || !validation?.ok || blockers > 0}
                className="gap-1.5"
              >
                <FloppyDisk className="size-4" />
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Save app'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Inline data-domain create — resolves a "no data source" fix-it without leaving. */}
      <DomainFormPanel
        open={wirePhrase !== null}
        onOpenChange={(o) => !o && setWirePhrase(null)}
        title="Wire a data source"
        description="Point this app at where the data actually lives — pick the connector and the table / path / object it reads."
        submitLabel="Create data source"
        connectors={connectors}
        initial={{ label: wirePhrase ?? '', connectorId: '', resource: '', aliasesRaw: '' }}
        submitUrl="/api/v1/admin/data-domains"
        method="POST"
        onSaved={() => {
          setWirePhrase(null);
          void refreshDomains();
          toast.success('Data source created — pick it on the step that needs it.');
        }}
      />
    </div>
  );
}

// ─── Guided refine: steps in the wide column, identity + trigger + visibility in the side column ──
function GuidedRefine({
  spec,
  names,
  highlightStep,
  handlersFor,
  onSpec,
}: {
  spec: AppSpec;
  names: BindingNames;
  highlightStep: string | null;
  handlersFor: (id: string) => StepEditorHandlers;
  onSpec: (fn: (s: AppSpec | null) => AppSpec | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {/* Steps take the wide column */}
      <div className="space-y-2.5 xl:col-span-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="size-4 text-primary" />
              The steps
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              The process we carved from your description. Reorder, relabel, rebind a data source or
              agent, or add and remove steps. Each step runs governed.
            </p>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {spec.steps.map((step, i) => (
              <div key={step.id} id={`step-${step.id}`} className="scroll-mt-24">
                <div
                  className={
                    highlightStep === step.id
                      ? 'rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background transition-shadow'
                      : ''
                  }
                >
                  <AppStepEditor
                    step={step}
                    index={i}
                    total={spec.steps.length}
                    names={names}
                    handlers={handlersFor(step.id)}
                  />
                </div>
              </div>
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
                  onClick={() => onSpec((s) => (s ? addStep(s, k.kind) : s))}
                >
                  <Plus className="size-3" />
                  {k.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Identity + trigger + visibility in the side column */}
      <div className="space-y-5">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Name &amp; describe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={spec.title}
                onChange={(e) => onSpec((s) => (s ? setTitle(s, e.target.value) : s))}
                placeholder="Reimbursement approval"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Summary</Label>
              <Textarea
                value={spec.summary}
                onChange={(e) => onSpec((s) => (s ? setSummary(s, e.target.value) : s))}
                rows={2}
                placeholder="What this app does, in a sentence."
                className="text-sm"
              />
            </div>
          </CardContent>
        </Card>
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
                onClick={() => onSpec((s) => (s ? setTrigger(s, t.kind) : s))}
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
                onClick={() => onSpec((s) => (s ? setVisibility(s, v.id) : s))}
              />
            ))}
          </CardContent>
        </Card>
      </div>
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
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Describe what this app should do
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Write it in plain language — the outcome you want and the steps it should take. We turn
            it into a governed, runnable app. An agent is just the simplest app: one step.
          </p>
        </div>

        <Card className="shadow-sm">
          <CardContent className="space-y-3 py-4">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={7}
              placeholder="e.g. Reimbursement approval — read the invoice, check the employee's quota, decide if they're eligible, then have a manager approve or reject."
              className="text-sm"
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                We only bind steps to data sources your org has declared — never a fabricated one.
              </p>
              <Button
                onClick={onCompile}
                disabled={description.trim().length < 8 || compiling}
                className="gap-1.5"
              >
                <Sparkle className="size-4" />
                {compiling ? 'Carving steps…' : 'Build the steps'}
                {!compiling ? <ArrowRight className="size-4" /> : null}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <HowThisWorks text="Three steps: describe it, resolve anything we flag (one-click), then save. You never touch nodes or wiring unless you want to." />
        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground/70">
            Or start from an example
          </p>
          <div className="grid grid-cols-1 gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => setDescription(ex.text)}
                className="rounded-md border border-border p-3 text-left hover:border-primary/40"
              >
                <div className="text-sm font-medium text-foreground">{ex.label}</div>
                <div className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground">
                  {ex.text}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── The fix-it panel — warnings as one-click actions ────────────────────────────────────────────
function FixItPanel({ items, onAct }: { items: FixIt[]; onAct: (f: FixIt) => void }) {
  const blockers = items.filter((i) => i.severity === 'blocker');
  const advisories = items.filter((i) => i.severity === 'advisory');
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-4">
      <div className="flex items-center gap-1.5">
        <Warning className="size-4 text-amber-600 dark:text-amber-500" weight="fill" />
        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
          {blockers.length > 0
            ? `${blockers.length} thing${blockers.length === 1 ? '' : 's'} to resolve`
            : 'A few things to review'}
        </span>
      </div>
      {blockers.length > 0 ? (
        <div className="mt-2.5 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {blockers.map((f) => (
            <FixItRow key={f.id} item={f} onAct={onAct} />
          ))}
        </div>
      ) : null}
      {advisories.length > 0 ? (
        <ul className="mt-2.5 space-y-1 border-t border-amber-500/20 pt-2.5 text-[11px] text-amber-800 dark:text-amber-300/90">
          {advisories.map((f) => (
            <li key={f.id} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span>{f.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FixItRow({ item, onAct }: { item: FixIt; onAct: (f: FixIt) => void }) {
  const cta =
    item.action === 'wire-data-source'
      ? 'Wire a data source'
      : item.action === 'bind-step'
        ? 'Pick a data source'
        : item.action === 'add-instructions'
          ? 'Write instructions'
          : 'Fix this step';
  const Icon =
    item.action === 'wire-data-source' || item.action === 'bind-step' ? Database : PencilSimple;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-background px-3 py-2">
      <span className="min-w-0 truncate text-xs text-foreground" title={item.title}>
        {item.title}
      </span>
      <Button size="sm" className="h-7 shrink-0 gap-1 text-xs" onClick={() => onAct(item)}>
        <Icon className="size-3.5" />
        {cta}
      </Button>
    </div>
  );
}

function HowThisWorks({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span>{text}</span>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">
      <button
        type="button"
        onClick={() => onChange('guided')}
        className={
          view === 'guided'
            ? 'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-primary'
            : 'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground'
        }
        aria-pressed={view === 'guided'}
      >
        <ListChecks className="size-3.5" />
        Guided
      </button>
      <button
        type="button"
        onClick={() => onChange('visual')}
        className={
          view === 'visual'
            ? 'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-primary'
            : 'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground'
        }
        aria-pressed={view === 'visual'}
      >
        <TreeStructure className="size-3.5" />
        Advanced / visual
      </button>
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

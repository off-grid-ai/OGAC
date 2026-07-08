'use client';

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Database,
  Plus,
  Sparkle,
  Wrench,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AgentRunner } from '@/components/agents/AgentRunner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  buildAgentPayload,
  buildTemplatePayload,
  deriveTitle,
  GUIDED_TEMPLATES,
  planAssistant,
  validateBuilderInput,
  type DataCollection,
  type Skill,
  type Visibility,
} from '@/lib/studio-builder';

// ─── The 4-step guided builder (Phase 4.5) ──────────────────────────────────────
// A non-technical person builds a governed assistant by answering four plain questions. The step
// lives in the URL (?step=goal|skills|data|publish) so Back walks the wizard and each step is
// deep-linkable — no modals. The plain-language → config translation (systemPrompt, skills,
// collections, model) is done by the PURE mapper in lib/studio-builder; this component only collects
// input and, on publish, POSTs the two payloads to the existing governed routes.

type StepId = 'goal' | 'skills' | 'data' | 'publish';
const STEPS: { id: StepId; label: string }[] = [
  { id: 'goal', label: 'Goal' },
  { id: 'skills', label: 'Skills' },
  { id: 'data', label: 'Data' },
  { id: 'publish', label: 'Publish' },
];

const VISIBILITY: { id: Visibility; label: string; hint: string }[] = [
  { id: 'private', label: 'Just me', hint: 'Only you can use it' },
  { id: 'org', label: 'My org', hint: 'Everyone in the org can find and chat with it' },
  { id: 'public', label: 'Shareable link', hint: 'Publishes a direct link anyone with it can use' },
];

export function StudioBuilder({
  tools,
  collections,
  allowedModels,
}: {
  tools: Skill[];
  collections: DataCollection[];
  allowedModels: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Navigation position (the current step) lives in the URL.
  const rawStep = params.get('step');
  const step: StepId = STEPS.some((s) => s.id === rawStep) ? (rawStep as StepId) : 'goal';
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const goTo = useCallback(
    (id: StepId) => {
      const next = new URLSearchParams(params.toString());
      next.set('step', id);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  // Builder form values — these are content, not navigation, so they stay in component state.
  const [templateId, setTemplateId] = useState('');
  const [goal, setGoal] = useState('');
  const [title, setTitle] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [grounded, setGrounded] = useState(true);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [created, setCreated] = useState<{ agentId: string; title: string; url?: string } | null>(
    null,
  );

  const check = validateBuilderInput({
    goal,
    title,
    templateId,
    grounded,
    visibility,
    toolIds: selectedTools,
    collectionIds: selectedCollections,
  });

  // The live, computed configuration the review screen shows and publish uses.
  const plan = useMemo(
    () => (check.ok ? planAssistant(check.value!, { skills: tools, collections, allowedModels }) : null),
    [check.ok, check.value, tools, collections, allowedModels],
  );

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = GUIDED_TEMPLATES.find((x) => x.id === id);
    if (t) {
      if (t.goal) setGoal(t.goal);
      setGrounded(t.grounded);
    }
  }

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  // Ask the gateway to refine name + relevant skills from the goal. Best-effort — any failure leaves
  // the form untouched and the user configures it by hand.
  async function suggest() {
    if (goal.trim().length < 10 || suggesting) return;
    setSuggesting(true);
    try {
      const res = await fetch('/api/v1/studio/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal, tools }),
      });
      const s = (await res.json().catch(() => ({}))) as {
        title?: string;
        toolIds?: string[];
        grounded?: boolean | null;
      };
      if (s.title && !title.trim()) setTitle(s.title);
      if (Array.isArray(s.toolIds) && s.toolIds.length) setSelectedTools(s.toolIds);
      if (typeof s.grounded === 'boolean') setGrounded(s.grounded);
      toast.success('Suggested a setup from your description — tweak anything you like.');
    } catch {
      toast.error('Could not suggest right now — configure it below.');
    } finally {
      setSuggesting(false);
    }
  }

  function reset() {
    setTemplateId('');
    setGoal('');
    setTitle('');
    setSelectedTools([]);
    setSelectedCollections([]);
    setGrounded(true);
    setVisibility('private');
    setCreated(null);
    goTo('goal');
  }

  async function publish() {
    if (!plan || busy) return;
    setBusy(true);
    try {
      // 1. Create the governed agent from the generated config (prompt + resolved skills + model).
      const agentRes = await fetch('/api/v1/admin/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildAgentPayload(plan)),
      });
      if (!agentRes.ok) throw new Error('Could not create the assistant');
      const agent = (await agentRes.json()) as { id: string };

      // 2. Save the Studio template pointing at it (mints /app/<slug> when shareable).
      const tplRes = await fetch('/api/v1/studio/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildTemplatePayload(agent.id, plan)),
      });
      const tpl = (await tplRes.json().catch(() => ({}))) as { url?: string };

      toast.success(
        tpl.url ? `"${plan.title}" published — shareable at ${tpl.url}` : `"${plan.title}" created`,
      );
      setCreated({ agentId: agent.id, title: plan.title, url: tpl.url ?? undefined });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create the assistant');
    } finally {
      setBusy(false);
    }
  }

  // Post-publish: success banner + inline governed test, no page change.
  if (created) {
    return (
      <div className="space-y-5">
        <Card className="border-primary/30 bg-primary/5 shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <CheckCircle className="size-5 text-primary" weight="fill" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                &ldquo;{created.title}&rdquo; is live.
              </p>
              <p className="text-xs text-muted-foreground">
                It runs through the full governed pipeline. Try it below.
                {created.url ? (
                  <>
                    {' '}
                    Shared at{' '}
                    <a
                      href={created.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {created.url}
                    </a>
                    .
                  </>
                ) : null}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
              <Plus className="size-4" />
              New assistant
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/build/studio">Done</Link>
            </Button>
          </CardContent>
        </Card>
        <AgentRunner agentId={created.agentId} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)] xl:gap-8">
      {/* Left rail — stepper + a live setup summary that fills as you go. Sticky on desktop. */}
      <aside className="space-y-4 lg:sticky lg:top-6">
        {/* Stepper — vertical on desktop, click a completed/earlier step to jump back */}
        <ol className="flex flex-wrap items-center gap-1.5 text-xs lg:flex-col lg:items-stretch lg:gap-1">
          {STEPS.map((s, i) => {
            const active = s.id === step;
            const done = i < stepIndex;
            return (
              <li key={s.id} className="flex items-center gap-1.5 lg:w-full">
                <button
                  type="button"
                  onClick={() => (i <= stepIndex ? goTo(s.id) : undefined)}
                  disabled={i > stepIndex}
                  className={
                    active
                      ? 'flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-primary lg:w-full lg:py-2'
                      : done
                        ? 'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-foreground hover:bg-muted lg:w-full lg:py-2'
                        : 'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-muted-foreground lg:w-full lg:py-2'
                  }
                >
                  <span
                    className={
                      active || done
                        ? 'flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground'
                        : 'flex size-4 items-center justify-center rounded-full bg-muted text-[10px]'
                    }
                  >
                    {i + 1}
                  </span>
                  {s.label}
                </button>
                {i < STEPS.length - 1 ? (
                  <span className="text-muted-foreground/40 lg:hidden">/</span>
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* Live setup summary — uses the otherwise-dead left gutter on wide screens */}
        <Card className="hidden shadow-sm lg:block">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground/70">
              Setup so far
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <SummaryRow label="Name">
              {title.trim() || (goal.trim() ? deriveTitle(goal) : '—')}
            </SummaryRow>
            <SummaryRow label="Goal">
              {goal.trim() ? (
                <span className="line-clamp-3 text-muted-foreground">{goal.trim()}</span>
              ) : (
                '—'
              )}
            </SummaryRow>
            <SummaryRow label="Skills">
              {plan?.skillNames.length ? plan.skillNames.join(', ') : 'None'}
            </SummaryRow>
            <SummaryRow label="Knowledge">
              {plan
                ? plan.grounded
                  ? plan.collectionNames.length
                    ? plan.collectionNames.join(', ')
                    : 'All you can access'
                  : 'Model (not grounded)'
                : '—'}
            </SummaryRow>
            <SummaryRow label="Model">{plan?.suggestedModel || 'Platform default'}</SummaryRow>
          </CardContent>
        </Card>
      </aside>

      {/* Right column — the active step's form + wizard nav */}
      <div className="min-w-0 space-y-5">
      {/* STEP 1 — Goal */}
      {step === 'goal' ? (
        <div className="space-y-5">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Start from a template (optional)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Pick a starting point, or start from scratch and describe your own.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {GUIDED_TEMPLATES.map((t) => {
                const on = templateId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t.id)}
                    className={
                      on
                        ? 'rounded-md border border-primary bg-primary/5 p-3 text-left'
                        : 'rounded-md border border-border p-3 text-left hover:border-primary/40'
                    }
                  >
                    <div className="text-sm font-medium text-foreground">{t.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{t.blurb}</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">What should this assistant do?</CardTitle>
              <p className="text-xs text-muted-foreground">
                Describe it in plain language — the outcome you want, and how it should behave.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={5}
                placeholder="e.g. Answer employee questions about our HR policies, and always cite the policy document you used."
                className="text-sm"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={suggest}
                  disabled={goal.trim().length < 10 || suggesting}
                  className="gap-1.5"
                >
                  <Sparkle className="size-4" />
                  {suggesting ? 'Thinking…' : 'Suggest a setup'}
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assistant-name" className="text-xs text-muted-foreground">
                  Name (optional)
                </Label>
                <Input
                  id="assistant-name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={goal.trim() ? deriveTitle(goal) : 'HR Policy Assistant'}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* STEP 2 — Skills */}
      {step === 'skills' ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wrench className="size-4 text-primary" />
              What can it do? (optional)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Give it skills — the tools your org has set up (search, call a connector, generate a
              doc). Each stays governed by its own action policy.
            </p>
          </CardHeader>
          <CardContent>
            {tools.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No tools set up yet. Your admin can add them on the Integrations page. The assistant
                will still answer from its instructions and your knowledge.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tools.map((t) => {
                  const on = selectedTools.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTools((cur) => toggle(cur, t.id))}
                      title={t.description}
                      className={
                        on
                          ? 'rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-xs text-primary'
                          : 'rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40'
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* STEP 3 — Data */}
      {step === 'data' ? (
        <div className="space-y-5">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="size-4 text-primary" />
                What knowledge should it use? (optional)
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Pick the knowledge collections it may draw on. It only ever sees what your role is
                allowed to — access is enforced at run time, never widened here.
              </p>
            </CardHeader>
            <CardContent>
              {collections.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No knowledge collections yet. Add documents on the Knowledge page, then they show
                  up here. Turn grounding on below to answer strictly from your knowledge.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {collections.map((c) => {
                    const on = selectedCollections.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCollections((cur) => toggle(cur, c.id))}
                        className={
                          on
                            ? 'flex w-full items-center justify-between rounded-md border border-primary bg-primary/5 px-3 py-2 text-left'
                            : 'flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:border-primary/40'
                        }
                      >
                        <div>
                          <div className="text-sm text-foreground">{c.name}</div>
                          {c.description ? (
                            <div className="text-[11px] text-muted-foreground">{c.description}</div>
                          ) : null}
                        </div>
                        {on ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary">
                            selected
                          </Badge>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="flex items-center justify-between gap-3 py-3">
              <div>
                <Label htmlFor="grounded" className="text-sm">
                  Answer only from knowledge
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  It answers strictly from your documents and cites them — it won&apos;t make things
                  up. Turn off for a general/creative assistant.
                </p>
              </div>
              <Switch
                id="grounded"
                checked={grounded || selectedCollections.length > 0}
                disabled={selectedCollections.length > 0}
                onCheckedChange={setGrounded}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* STEP 4 — Publish (review + test) */}
      {step === 'publish' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="space-y-5">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Name it</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={goal.trim() ? deriveTitle(goal) : 'HR Policy Assistant'}
              />
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Who can use it?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {VISIBILITY.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVisibility(v.id)}
                  className={
                    visibility === v.id
                      ? 'flex w-full items-center justify-between rounded-md border border-primary bg-primary/5 px-3 py-2 text-left'
                      : 'flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:border-primary/40'
                  }
                >
                  <div>
                    <div className="text-sm text-foreground">{v.label}</div>
                    <div className="text-[11px] text-muted-foreground">{v.hint}</div>
                  </div>
                  {visibility === v.id ? (
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      selected
                    </Badge>
                  ) : null}
                </button>
              ))}
            </CardContent>
          </Card>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Review the setup</CardTitle>
              <p className="text-xs text-muted-foreground">
                This is what Studio generated from your description — no jargon required.
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {plan ? (
                <>
                  <ReviewRow label="Instructions">
                    <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs text-foreground">
                      {plan.systemPrompt}
                    </pre>
                  </ReviewRow>
                  <ReviewRow label="Skills">
                    {plan.skillNames.length ? plan.skillNames.join(', ') : 'None'}
                  </ReviewRow>
                  <ReviewRow label="Knowledge">
                    {plan.grounded
                      ? plan.collectionNames.length
                        ? plan.collectionNames.join(', ')
                        : 'All knowledge you can access'
                      : 'Answers from the model (not grounded)'}
                  </ReviewRow>
                  <ReviewRow label="Model">
                    {plan.suggestedModel || 'Platform default'}
                  </ReviewRow>
                </>
              ) : (
                <p className="text-xs text-destructive">{check.error}</p>
              )}
            </CardContent>
          </Card>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {check.ok ? 'Ready. Publish it through the governed pipeline.' : check.error}
            </p>
            <Button onClick={publish} disabled={!plan || busy} className="gap-1.5">
              <Sparkle className="size-4" />
              {busy ? 'Publishing…' : 'Publish & test'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Wizard nav — Back / Next; the step lives in the URL */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => goTo(STEPS[Math.max(0, stepIndex - 1)].id)}
          disabled={stepIndex === 0}
          className="gap-1.5"
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>
        {step !== 'publish' ? (
          <Button
            size="sm"
            onClick={() => goTo(STEPS[stepIndex + 1].id)}
            disabled={step === 'goal' && !check.ok}
            className="gap-1.5"
          >
            Next
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="break-words text-foreground">{children}</div>
    </div>
  );
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="text-xs text-foreground">{children}</div>
    </div>
  );
}

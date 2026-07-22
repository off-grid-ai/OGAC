'use client';

import {
  ArrowUp,
  Database,
  Export,
  Lightning,
  Path,
  Robot,
  ShieldCheck,
  Sparkle,
  Stack,
  TreeStructure,
  User,
  Warning,
} from '@phosphor-icons/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BuilderCapabilityContext,
  useBuilderCapabilityContext,
} from '@/components/build/BuilderCapabilityContext';
import { InheritanceBanner } from '@/components/build/InheritanceBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  forgePreviewFromQuery,
  forgePreviewHref,
  type ForgePreview,
} from '@/lib/builder-navigation';
import {
  resolveBuilderSurfaceAccess,
  type BuilderSurfaceAccess,
} from '@/lib/builder-surface-access';
import type { OrgContextSummary } from '@/lib/org-context';

// ─── Studio Forge — the conversational app builder (bolt.new / lovable pattern, governed) ──────────
// Left pane = a CHAT you build in ("describe an app" → it compiles → refine by chatting). Right pane =
// a LIVE PREVIEW of the governed AppSpec it produced + the org context it INHERITS (pipeline, gateway
// models, data connectors/domains/KB, regulations = guardrails/policy). Unlike bolt.new (arbitrary
// codegen in a sandbox), every app here is a governed spec that runs on YOUR pipelines under YOUR
// policy — so the preview foregrounds the inheritance, which is the differentiator. It reuses the
// existing NL→AppSpec compiler (/api/v1/admin/apps/compile) and save path (/api/v1/admin/apps) — this
// is a new SKIN over the real engine, not a parallel builder.

// Minimal shapes (the compiler returns the full AppSpec; we render the fields we preview).
interface AppStep {
  id: string;
  kind: 'agent' | 'connector-query' | 'guardrail' | 'human' | 'output';
  label?: string;
  title?: string;
  instruction?: string;
}
interface FormField {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
}
interface AppSpec {
  id: string;
  title: string;
  summary: string;
  visibility: 'private' | 'org' | 'public';
  pipelineId?: string | null;
  trigger: { kind: string };
  inputForm?: FormField[];
  steps: AppStep[];
  edges: { from: string; to: string }[];
}
interface ChatTurn {
  role: 'user' | 'forge';
  text: string;
}

const STEP_META: Record<AppStep['kind'], { icon: typeof Robot; tint: string; label: string }> = {
  agent: { icon: Robot, tint: 'text-primary', label: 'Agent' },
  'connector-query': { icon: Database, tint: 'text-sky-500', label: 'Data query' },
  guardrail: { icon: ShieldCheck, tint: 'text-amber-500', label: 'Guardrail' },
  human: { icon: User, tint: 'text-violet-500', label: 'Human approval' },
  output: { icon: Export, tint: 'text-emerald-500', label: 'Output' },
};

const EXAMPLES = [
  'A weekly cross-sell advisor that finds the top 10 accounts likely to buy a second product and emails each owner a one-line pitch',
  'Summarize every new support ticket, flag the angry ones, and post a daily digest',
  'When a contract PDF lands, extract the parties, value, and renewal date, and check it against our policy',
  'A KYC assistant that answers questions about a customer from our own records, with PII masked',
];

const PREVIEWS: readonly { id: ForgePreview; label: string }[] = [
  { id: 'app', label: 'App' },
  { id: 'flow', label: 'Flow' },
  { id: 'governance', label: 'Governance' },
];

export function StudioForge({
  summary,
  pipelineOptions,
}: Readonly<{
  summary: OrgContextSummary;
  pipelineOptions: { id: string; name: string }[];
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const preview = forgePreviewFromQuery(params);
  const capabilityContext = useBuilderCapabilityContext();
  const access = resolveBuilderSurfaceAccess(capabilityContext.state, false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [brief, setBrief] = useState(''); // accumulated description the compiler sees
  const [input, setInput] = useState('');
  const [spec, setSpec] = useState<AppSpec | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const navigatePreview = (nextPreview: ForgePreview) => {
    if (nextPreview === preview) return;
    router.push(forgePreviewHref(pathname, params.toString(), nextPreview), { scroll: false });
  };

  const scrollDown = () => requestAnimationFrame(() => threadRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }));

  async function send(text: string) {
    const msg = text.trim();
    if (!access.canCreate || msg.length < 4 || busy) return;
    // First message = the brief; subsequent = refinements appended to the same brief so the compiler
    // re-plans with the full intent (reuses the one compiler; no separate refine engine to drift).
    const nextBrief = brief ? `${brief}\n\nAlso: ${msg}` : msg;
    setTurns((t) => [...t, { role: 'user', text: msg }]);
    setInput('');
    setBrief(nextBrief);
    setBusy(true);
    scrollDown();
    try {
      const res = await fetch('/api/v1/admin/apps/compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: nextBrief }),
      });
      if (!res.ok) throw new Error('Could not build from that description');
      const data = (await res.json()) as { spec: AppSpec; gaps: string[] };
      setSpec(data.spec);
      setGaps(data.gaps ?? []);
      const stepWord = `${data.spec.steps.length} step${data.spec.steps.length === 1 ? '' : 's'}`;
      const gapWord = data.gaps?.length ? ` I flagged ${data.gaps.length} thing${data.gaps.length === 1 ? '' : 's'} to resolve.` : '';
      setTurns((t) => [
        ...t,
        { role: 'forge', text: `Built "${data.spec.title}" — ${stepWord}, running on ${pipelineName(data.spec.pipelineId)}.${gapWord} See the preview →` },
      ]);
      navigatePreview(data.gaps?.length ? 'governance' : 'app');
      scrollDown();
    } catch (e) {
      setTurns((t) => [...t, { role: 'forge', text: e instanceof Error ? e.message : 'Build failed' }]);
    } finally {
      setBusy(false);
    }
  }

  function pipelineName(id?: string | null): string {
    if (!id) return 'the org default pipeline';
    return pipelineOptions.find((p) => p.id === id)?.name ?? 'the org default pipeline';
  }

  async function save() {
    if (!access.canSave || !spec || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: spec.title,
          summary: spec.summary,
          visibility: spec.visibility,
          pipelineId: spec.pipelineId ?? null,
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
      router.push(`/solutions/apps/${app.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-3 lg:h-[calc(100vh-8.5rem)] lg:min-h-0 lg:flex-row">
      {/* ── LEFT: conversation ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-[32rem] w-full shrink-0 flex-col rounded-lg border border-border bg-card lg:min-h-0 lg:max-w-[440px]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Lightning weight="fill" className="size-4 text-primary" />
          <div>
            <div className="font-mono text-sm font-semibold">Studio Forge</div>
            <div className="text-[11px] text-muted-foreground">Describe an app — it builds on your pipelines, gateway, data & rules</div>
          </div>
        </div>

        <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {turns.length === 0 ? (
            <ForgeExamplePrompts access={access} onSend={send} />
          ) : (
            turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    t.role === 'user'
                      ? 'max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-xs leading-relaxed text-foreground'
                      : 'flex max-w-[90%] gap-2 text-xs leading-relaxed text-muted-foreground'
                  }
                >
                  {t.role === 'forge' ? <Sparkle weight="fill" className="mt-0.5 size-3.5 shrink-0 text-primary" /> : null}
                  <span>{t.text}</span>
                </div>
              </div>
            ))
          )}
          {busy ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkle weight="fill" className="size-3.5 animate-pulse text-primary" /> Forging…
            </div>
          ) : null}
        </div>

        <ForgeComposer
          access={access}
          busy={busy}
          input={input}
          hasSpec={Boolean(spec)}
          onInput={setInput}
          onSend={() => send(input)}
        />
      </div>

      {/* ── RIGHT: live preview ────────────────────────────────────────────────────── */}
      <div className="flex min-h-[32rem] min-w-0 flex-1 flex-col rounded-lg border border-border bg-card lg:min-h-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="flex gap-1">
            {PREVIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigatePreview(item.id)}
                aria-pressed={preview === item.id}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                  preview === item.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
                {item.id === 'governance' && gaps.length > 0 ? (
                  <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-600">
                    {gaps.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <ForgeSaveControl
            access={access}
            hasSpec={Boolean(spec)}
            saving={saving}
            onSave={save}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <BuilderCapabilityContext
              state={capabilityContext.state}
              onRetry={capabilityContext.retry}
            />
          </div>
          {!spec ? (
            <div className="mx-auto max-w-xl space-y-4 pt-6">
              <div className="text-center text-sm text-muted-foreground">
                Your app preview will appear here. It already inherits everything below — you never start from zero.
              </div>
              <InheritanceBanner summary={summary} />
            </div>
          ) : preview === 'app' ? (
            <AppPreview spec={spec} pipelineName={pipelineName(spec.pipelineId)} />
          ) : preview === 'flow' ? (
            <FlowPreview spec={spec} />
          ) : (
            <GovernancePane spec={spec} summary={summary} pipelineName={pipelineName(spec.pipelineId)} gaps={gaps} />
          )}
        </div>
      </div>
    </div>
  );
}

function AppPreview({ spec, pipelineName }: Readonly<{ spec: AppSpec; pipelineName: string }>) {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-lg font-semibold">{spec.title}</h2>
          <Badge variant="secondary" className="text-[10px] capitalize">{spec.trigger.kind.replace('-', ' ')}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{spec.summary}</p>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-primary">
          <Path className="size-3.5" /> Runs on {pipelineName}
        </div>
      </div>

      {spec.inputForm?.length ? (
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Inputs</div>
          <div className="space-y-2">
            {spec.inputForm.map((f) => (
              <div key={f.name}>
                <label className="text-xs text-muted-foreground">
                  {f.label ?? f.name}
                  {f.required ? <span className="text-destructive"> *</span> : null}
                </label>
                <div className="mt-1 h-8 rounded-md border border-input bg-background/40 px-2 text-xs leading-8 text-muted-foreground/60">
                  {f.type ?? 'text'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-md border border-border p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          What it does · {spec.steps.length} step{spec.steps.length === 1 ? '' : 's'}
        </div>
        <ol className="space-y-1.5">
          {spec.steps.map((s, i) => {
            const meta = STEP_META[s.kind];
            const Icon = meta?.icon ?? Robot;
            return (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 w-4 text-right font-mono text-muted-foreground/60">{i + 1}</span>
                <Icon className={`mt-0.5 size-3.5 shrink-0 ${meta?.tint ?? ''}`} />
                <span className="text-foreground">{s.title ?? s.label ?? meta?.label ?? s.kind}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function FlowPreview({ spec }: Readonly<{ spec: AppSpec }>) {
  return (
    <div className="mx-auto max-w-md space-y-1.5">
      {spec.steps.map((s, i) => {
        const meta = STEP_META[s.kind];
        const Icon = meta?.icon ?? Robot;
        return (
          <div key={s.id}>
            <div className="flex items-center gap-2.5 rounded-md border border-border bg-background/40 px-3 py-2.5">
              <Icon className={`size-4 shrink-0 ${meta?.tint ?? ''}`} />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{s.title ?? s.label ?? meta?.label ?? s.kind}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{meta?.label ?? s.kind}</div>
              </div>
            </div>
            {i < spec.steps.length - 1 ? <div className="ml-[1.4rem] h-3 w-px bg-border" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function GovernancePane({
  spec,
  summary,
  pipelineName,
  gaps,
}: Readonly<{ spec: AppSpec; summary: OrgContextSummary; pipelineName: string; gaps: string[] }>) {
  const rows = [
    { icon: Path, label: 'Pipeline', value: pipelineName, hint: 'The governed lane every run is tagged to' },
    { icon: Sparkle, label: 'Gateway', value: `${summary.models.count} model${summary.models.count === 1 ? '' : 's'}${summary.routing.enabled ? ` · ${summary.routing.enabled} routing rule${summary.routing.enabled === 1 ? '' : 's'}` : ''}`, hint: summary.models.names.slice(0, 4).join(', ') },
    { icon: TreeStructure, label: 'Data', value: `${summary.connectors.count} connector${summary.connectors.count === 1 ? '' : 's'} · ${summary.dataDomains.count} domain${summary.dataDomains.count === 1 ? '' : 's'}`, hint: [...summary.connectors.names, ...summary.dataDomains.names].slice(0, 4).join(', ') },
    { icon: Stack, label: 'Knowledge', value: `${summary.brain.documentCount} document${summary.brain.documentCount === 1 ? '' : 's'} in the Brain`, hint: 'Retrieval-grounded, on-device' },
    { icon: ShieldCheck, label: 'Regulations', value: `guardrails ${summary.guardrails.on ? 'on' : 'off'} · policy v${summary.policy.version} · egress ${summary.policy.egressAllowed ? 'allowed' : 'blocked'}`, hint: 'Inherited automatically — every run is screened' },
  ];
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{spec.title}</span> inherits your whole governed stack automatically —
        nothing here was configured by hand, and nothing leaves your network.
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 px-3 py-2.5">
            <r.icon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{r.label}</div>
              <div className="text-xs text-foreground">{r.value}</div>
              {r.hint ? <div className="truncate text-[11px] text-muted-foreground/70">{r.hint}</div> : null}
            </div>
          </div>
        ))}
      </div>
      {gaps.length ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-600">
            <Warning className="size-3.5" /> {gaps.length} thing{gaps.length === 1 ? '' : 's'} to resolve
          </div>
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {gaps.map((g, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-amber-600">•</span> {g}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground/70">Save &amp; open to resolve these in the full builder.</p>
        </div>
      ) : null}
    </div>
  );
}

export function ForgeExamplePrompts({
  access,
  onSend,
}: Readonly<{
  access: BuilderSurfaceAccess;
  onSend: (example: string) => void;
}>) {
  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs text-muted-foreground">Tell Forge what you want to build. Try:</p>
      {EXAMPLES.map((example) => (
        <button
          key={example}
          type="button"
          onClick={() => onSend(example)}
          disabled={!access.canCreate}
          title={!access.canCreate ? access.createExplanation : undefined}
          className="block w-full rounded-md border border-border px-3 py-2 text-left text-xs leading-relaxed text-muted-foreground transition-colors duration-150 hover:border-primary hover:text-foreground active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {example}
        </button>
      ))}
    </div>
  );
}

export function ForgeComposer({
  access,
  busy,
  input,
  hasSpec,
  onInput,
  onSend,
}: Readonly<{
  access: BuilderSurfaceAccess;
  busy: boolean;
  input: string;
  hasSpec: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
}>) {
  const explanationId = 'forge-create-explanation';
  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:border-primary">
        <textarea
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (access.canCreate) onSend();
            }
          }}
          rows={Math.min(4, input.split('\n').length)}
          placeholder={
            hasSpec
              ? 'Refine it (for example, "email the result instead")'
              : 'Describe the app you want'
          }
          aria-describedby={!access.canCreate ? explanationId : undefined}
          className="max-h-28 flex-1 resize-none bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label="Build app"
          onClick={onSend}
          disabled={!access.canCreate || busy || input.trim().length < 4}
          title={!access.canCreate ? access.createExplanation : undefined}
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp weight="bold" className="size-4" />
        </button>
      </div>
      {!access.canCreate ? (
        <p
          id={explanationId}
          role="status"
          className="mt-2 text-[11px] leading-relaxed text-muted-foreground"
        >
          {access.createExplanation}
        </p>
      ) : null}
    </div>
  );
}

export function ForgeSaveControl({
  access,
  hasSpec,
  saving,
  onSave,
}: Readonly<{
  access: BuilderSurfaceAccess;
  hasSpec: boolean;
  saving: boolean;
  onSave: () => void;
}>) {
  return (
    <div className="flex max-w-sm flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {!access.canSave ? (
        <p role="status" className="text-right text-[11px] leading-relaxed text-muted-foreground">
          {access.saveExplanation}
        </p>
      ) : null}
      <Button
        size="sm"
        className="h-7 shrink-0 text-xs"
        disabled={!access.canSave || !hasSpec || saving}
        title={!access.canSave ? access.saveExplanation : undefined}
        onClick={onSave}
      >
        {saving ? 'Saving...' : 'Save and open'}
      </Button>
    </div>
  );
}

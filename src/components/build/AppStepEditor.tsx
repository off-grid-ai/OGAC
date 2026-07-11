'use client';

import {
  AppWindow,
  CaretDown,
  CaretUp,
  Database,
  FileText,
  Globe,
  Plugs,
  PuzzlePiece,
  Robot,
  ShieldCheck,
  Trash,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { describeStepBinding, type BindingNames } from '@/lib/app-builder';
import type { AppStep, AppStepKind, OutputStep } from '@/lib/app-model';

// ─── Tool catalog shape (mirrors GET /api/v1/admin/tool-catalog) ──────────────────────────────────
interface AppToolEntry { id: string; ref: string; name: string; description: string; cyclic: boolean }
interface PrimitiveEntry {
  id: string; ref: string; name: string; description: string; enabled: boolean;
  reachesInternet: boolean; airgapNote: string;
}
interface RegisteredEntry { id: string; ref: string; name: string; description: string; type: string; policy: string }
interface ToolCatalog { apps: AppToolEntry[]; primitives: PrimitiveEntry[]; registered: RegisteredEntry[] }

// ─── AppStepEditor (Builder Epic Phase 3A) ────────────────────────────────────────────────────────
// One card in the ordered step skeleton. Renders the step's kind icon + label + a per-kind binding
// editor (agent prompt/grounding or existing-agent dropdown; connector-query data-domain dropdown;
// output sink select). Reorder up/down + remove are always available. Every control calls a pure
// reducer from app-builder.ts on the parent's spec — this component holds NO state, it's a thin view.
// The founder's ask lives here: lots of inline hints + dropdowns so a non-technical dept head can
// refine the compiled process by hand.

export interface StepEditorHandlers {
  onRelabel: (label: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onRebindDomain: (domainId: string) => void;
  onRebindAgent: (agentId: string) => void;
  onSetPrompt: (prompt: string) => void;
  onToggleGrounding: (grounded: boolean) => void;
  onSetSink: (sink: OutputStep['sink']) => void;
  /** Set the tool refs an inline agent step may call (#117 composable tools). Optional: when absent
   *  the tool picker is hidden (a host that hasn't wired tool-setting yet). */
  onSetTools?: (toolRefs: string[]) => void;
}

const KIND_META: Record<AppStepKind, { icon: React.ReactNode; noun: string }> = {
  agent: { icon: <Robot className="size-4" />, noun: 'Agent decision' },
  'connector-query': { icon: <Database className="size-4" />, noun: 'Read from a data source' },
  guardrail: { icon: <ShieldCheck className="size-4" />, noun: 'Guardrail check' },
  human: { icon: <FileText className="size-4" />, noun: 'Human review / approve' },
  output: { icon: <FileText className="size-4" />, noun: 'Output result' },
};

// Delivery sinks the operator can pick. report + email DELIVER for real (signed PDF report; SMTP or
// Resend email — honest "not configured" when the channel isn't set up). WhatsApp is not wired yet, so
// it is shown but marked "coming soon" + disabled — we never fake a send we can't make.
const SINKS: { sink: OutputStep['sink']; label: string; comingSoon?: boolean }[] = [
  { sink: 'console', label: 'Console (record the result)' },
  { sink: 'report', label: 'Report (signed PDF)' },
  { sink: 'email', label: 'Email' },
  { sink: 'whatsapp', label: 'WhatsApp — coming soon', comingSoon: true },
];

export function AppStepEditor({
  step,
  index,
  total,
  names,
  handlers,
  appId,
}: {
  step: AppStep;
  index: number;
  total: number;
  names: BindingNames;
  handlers: StepEditorHandlers;
  /** The id of the app being edited — so the tool picker can flag apps-as-tools that would cycle. */
  appId?: string;
}) {
  const meta = KIND_META[step.kind];
  const binding = describeStepBinding(step, names);
  const unbound =
    (step.kind === 'connector-query' && !step.domain?.trim()) ||
    (step.kind === 'agent' && !step.agentId && !step.inlineAgent?.systemPrompt?.trim());

  return (
    <div className="rounded-md border border-border bg-background">
      {/* Header: order number, kind icon, editable label, reorder + delete */}
      <div className="flex items-start gap-3 border-b border-border/60 px-3 py-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
          {index + 1}
        </span>
        <span className="mt-1 shrink-0 text-primary" title={meta.noun}>
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <Input
            aria-label={`Step ${index + 1} label`}
            value={step.label}
            onChange={(e) => handlers.onRelabel(e.target.value)}
            placeholder={meta.noun}
            className="h-8 text-sm"
          />
          <p className={unbound ? 'mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500' : 'mt-1 text-[11px] text-muted-foreground'}>
            {unbound ? <Warning className="size-3" /> : null}
            {binding}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={index === 0}
            onClick={handlers.onMoveUp}
            aria-label="Move step up"
          >
            <CaretUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={index === total - 1}
            onClick={handlers.onMoveDown}
            aria-label="Move step down"
          >
            <CaretDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            disabled={total <= 1}
            onClick={handlers.onRemove}
            aria-label="Remove step"
          >
            <Trash className="size-4" />
          </Button>
        </div>
      </div>

      {/* Per-kind binding editor */}
      <div className="space-y-3 px-3 py-3">
        {step.kind === 'agent' ? (
          <AgentBinding step={step} names={names} handlers={handlers} appId={appId} />
        ) : null}
        {step.kind === 'connector-query' ? (
          <ConnectorBinding step={step} names={names} handlers={handlers} />
        ) : null}
        {step.kind === 'output' ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Where does the result go?</Label>
            <select
              value={step.sink}
              onChange={(e) => handlers.onSetSink(e.target.value as OutputStep['sink'])}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {SINKS.map((s) => (
                <option key={s.sink} value={s.sink} disabled={s.comingSoon}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Report renders a signed PDF; Email delivers via your on-prem SMTP or Resend (it reports
              &ldquo;not configured&rdquo; honestly if neither is set up). WhatsApp is coming soon. The
              outcome is always recorded to the console.
            </p>
          </div>
        ) : null}
        {step.kind === 'guardrail' ? (
          <p className="text-[11px] text-muted-foreground">
            Runs your org&apos;s guardrail checks over what flows into this step. A blocked verdict
            halts the run.
          </p>
        ) : null}
        {step.kind === 'human' ? (
          <p className="text-[11px] text-muted-foreground">
            Pauses the run for a person to review, approve, or reject. The review screen (with the
            input form) is set up in a later phase — for now the run pauses here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AgentBinding({
  step,
  names,
  handlers,
  appId,
}: {
  step: Extract<AppStep, { kind: 'agent' }>;
  names: BindingNames;
  handlers: StepEditorHandlers;
  appId?: string;
}) {
  const agents = names.agents ?? [];
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Use an existing agent, or write instructions</Label>
        <select
          value={step.agentId ?? ''}
          onChange={(e) => handlers.onRebindAgent(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">Inline — write instructions below</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {!step.agentId ? (
        <div className="space-y-2">
          <Textarea
            aria-label="Agent instructions"
            value={step.inlineAgent?.systemPrompt ?? ''}
            onChange={(e) => handlers.onSetPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Decide whether the employee is eligible: compare the invoice total against their remaining quota, and explain the decision."
            className="text-sm"
          />
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label className="text-xs">Answer only from knowledge (grounded)</Label>
              <p className="text-[11px] text-muted-foreground">
                Cites the sources it used and won&apos;t invent facts.
              </p>
            </div>
            <Switch
              checked={step.inlineAgent?.grounded ?? true}
              onCheckedChange={(v) => handlers.onToggleGrounding(v)}
            />
          </div>
          {handlers.onSetTools ? (
            <ToolPicker
              selected={step.inlineAgent?.tools ?? []}
              onChange={handlers.onSetTools}
              appId={appId}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConnectorBinding({
  step,
  names,
  handlers,
}: {
  step: Extract<AppStep, { kind: 'connector-query' }>;
  names: BindingNames;
  handlers: StepEditorHandlers;
}) {
  const domains = names.domains ?? [];
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Which data source does this step read?</Label>
      {domains.length === 0 ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          No data domains declared for your org yet — add a data-domain mapping (Data → Domains) so
          this step can bind to a real connector. Until then this step is unbound.
        </p>
      ) : (
        <select
          value={step.domain}
          onChange={(e) => handlers.onRebindDomain(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">— pick a data domain —</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── ToolPicker (Builder Epic #117) — the dead-simple, 3-group tool picker ────────────────────────
// The founder's ask: "picking a tool must be dead simple (a labeled picker), and everything stays
// governed." Three CLEARLY LABELED sources, each a list of checkbox rows with a name + a plain-language
// description — never raw ids. (1) Your apps — published apps as tools (an app that would create a
// cycle is disabled + labeled). (2) Primitives — web_search / read_url / http_fetch, each showing its
// enabled/off state (internet tools are OFF on an air-gapped deployment until the org opts in). (3)
// Registered tools — the org's existing http/mcp tools. Governed-by-default messaging up top.
function ToolPicker({
  selected,
  onChange,
  appId,
}: {
  selected: string[];
  onChange: (refs: string[]) => void;
  appId?: string;
}) {
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const qs = appId ? `?appId=${encodeURIComponent(appId)}` : '';
    fetch(`/api/v1/admin/tool-catalog${qs}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((data: ToolCatalog) => {
        if (live) { setCatalog(data); setError(false); }
      })
      .catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [appId]);

  const toggle = (ref: string) => {
    onChange(selected.includes(ref) ? selected.filter((r) => r !== ref) : [...selected, ref]);
  };

  const selectedCount = selected.length;

  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Tools this step can use</Label>
        {selectedCount > 0 ? (
          <span className="text-[10px] text-muted-foreground">{selectedCount} selected</span>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Grant this decision the ability to call your other apps, a built-in like web search, or a
        registered service. Every call stays governed by your org&apos;s policy.
      </p>

      {loading ? (
        <p className="text-[11px] text-muted-foreground">Loading tools…</p>
      ) : error ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          Couldn&apos;t load the tool catalog — try again.
        </p>
      ) : catalog ? (
        <div className="space-y-3 pt-1">
          {/* 1. Your apps */}
          <ToolGroup icon={<AppWindow className="size-3.5" />} title="Your apps" hint="Published apps, used as building blocks.">
            {catalog.apps.length === 0 ? (
              <EmptyRow text="No published apps yet — publish one to reuse it here." />
            ) : (
              catalog.apps.map((a) => (
                <ToolRow
                  key={a.ref}
                  name={a.name}
                  description={a.cyclic ? 'Would create a loop with this app — not allowed.' : a.description}
                  checked={selected.includes(a.ref)}
                  disabled={a.cyclic}
                  onToggle={() => toggle(a.ref)}
                />
              ))
            )}
          </ToolGroup>

          {/* 2. Primitives */}
          <ToolGroup icon={<PuzzlePiece className="size-3.5" />} title="Primitives" hint="Small built-in tools.">
            {catalog.primitives.map((p) => (
              <ToolRow
                key={p.ref}
                name={p.name}
                description={p.enabled ? p.description : `${p.airgapNote}`}
                checked={selected.includes(p.ref)}
                disabled={!p.enabled}
                badge={
                  p.reachesInternet ? (
                    <span
                      className={
                        p.enabled
                          ? 'inline-flex items-center gap-0.5 text-[9px] text-emerald-600 dark:text-emerald-500'
                          : 'inline-flex items-center gap-0.5 text-[9px] text-muted-foreground'
                      }
                      title={p.airgapNote}
                    >
                      <Globe className="size-2.5" />
                      {p.enabled ? 'online' : 'off (air-gapped)'}
                    </span>
                  ) : null
                }
                onToggle={() => toggle(p.ref)}
              />
            ))}
          </ToolGroup>

          {/* 3. Registered tools */}
          <ToolGroup icon={<Plugs className="size-3.5" />} title="Registered tools" hint="HTTP / MCP tools your org set up.">
            {catalog.registered.length === 0 ? (
              <EmptyRow text="No registered tools — add one under Tools." />
            ) : (
              catalog.registered.map((t) => (
                <ToolRow
                  key={t.ref}
                  name={t.name}
                  description={`${t.description} · ${t.type} · policy: ${t.policy}`}
                  checked={selected.includes(t.ref)}
                  disabled={t.policy === 'blocked'}
                  onToggle={() => toggle(t.ref)}
                />
              ))
            )}
          </ToolGroup>
        </div>
      ) : null}
    </div>
  );
}

function ToolGroup({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
        <span className="font-normal text-muted-foreground">· {hint}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ToolRow({
  name,
  description,
  checked,
  disabled,
  badge,
  onToggle,
}: {
  name: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  badge?: React.ReactNode;
  onToggle: () => void;
}) {
  return (
    <label
      className={
        disabled
          ? 'flex cursor-not-allowed items-start gap-2 rounded px-1.5 py-1 opacity-55'
          : 'flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-muted/50'
      }
    >
      <input
        type="checkbox"
        className="mt-0.5 size-3.5 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{name}</span>
          {badge}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-1.5 text-[11px] text-muted-foreground">{text}</p>;
}

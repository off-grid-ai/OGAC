'use client';

import {
  AppWindow,
  CaretDown,
  CaretUp,
  CheckSquareOffset,
  Database,
  FileText,
  Plugs,
  PuzzlePiece,
  Robot,
  ShieldCheck,
  Trash,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { ActionStepConfiguration } from '@/components/actions/ActionStepConfiguration';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureContent, DisclosureTrigger } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { describeStepBinding, type ActionStepPatch, type BindingNames } from '@/lib/app-builder';
import type { AppStep, AppStepKind, OutputStep } from '@/lib/app-model';
import {
  buildBuilderCatalogueOptions,
  type BuilderCatalogueOption,
} from '@/lib/builder-catalogue-options';
import type { BuilderSurfaceContextState } from '@/lib/builder-surface-access';

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
  /** Set/clear ONE config field on an output step (the sink's destination: url / channel / to /
   *  subject). Optional: when absent the per-sink config inputs are hidden (a host that hasn't wired
   *  config-setting yet), so the picker still works read-only. */
  onSetSinkConfig?: (key: string, value: string) => void;
  /** Set the tool refs an inline agent step may call (#117 composable tools). Optional: when absent
   *  the tool picker is hidden (a host that hasn't wired tool-setting yet). */
  onSetTools?: (toolRefs: string[]) => void;
  /** Configure a governed enterprise action through the pure AppSpec reducer. */
  onConfigureAction?: (patch: ActionStepPatch) => void;
}

const KIND_META: Record<AppStepKind, { icon: React.ReactNode; noun: string }> = {
  agent: { icon: <Robot className="size-4" />, noun: 'Agent decision' },
  'connector-query': { icon: <Database className="size-4" />, noun: 'Read from a data source' },
  guardrail: { icon: <ShieldCheck className="size-4" />, noun: 'Guardrail check' },
  human: { icon: <FileText className="size-4" />, noun: 'Human review / approve' },
  output: { icon: <FileText className="size-4" />, noun: 'Output result' },
  action: { icon: <CheckSquareOffset className="size-4" />, noun: 'Complete an action' },
};

// Delivery sinks the operator can pick. ALL of these DELIVER for real (each honest-degrades to "not
// configured" when its channel/secret isn't set up — we never fake a send we can't make):
//   • report   — a signed PDF export.
//   • email    — on-prem SMTP or Resend.
//   • webhook  — a signed JSON POST (HMAC) to any URL (ServiceNow / Jira / anything).
//   • slack    — post to a channel via a vaulted incoming-webhook.
//   • whatsapp — a message via your on-prem WhatsApp gateway.
const SINKS: { sink: OutputStep['sink']; label: string; comingSoon?: boolean }[] = [
  { sink: 'console', label: 'Console (record the result)' },
  { sink: 'report', label: 'Report (signed PDF)' },
  { sink: 'email', label: 'Email' },
  { sink: 'webhook', label: 'Webhook (signed JSON POST)' },
  { sink: 'slack', label: 'Slack (post to a channel)' },
  { sink: 'whatsapp', label: 'WhatsApp (on-prem gateway)' },
];

export function AppStepEditor({
  step,
  index,
  total,
  names,
  handlers,
  connectors = [],
  approvalSteps = [],
  capabilityContext,
}: Readonly<{
  step: AppStep;
  index: number;
  total: number;
  names: BindingNames;
  handlers: StepEditorHandlers;
  connectors?: { id: string; name: string; type: string; endpoint?: string }[];
  approvalSteps?: { id: string; label: string }[];
  capabilityContext: BuilderSurfaceContextState;
}>) {
  const meta = KIND_META[step.kind];
  const binding = describeStepBinding(step, names);
  const unbound =
    (step.kind === 'connector-query' && !step.domain?.trim()) ||
    (step.kind === 'agent' && !step.agentId && !step.inlineAgent?.systemPrompt?.trim()) ||
    (step.kind === 'action' && (!step.connectorId.trim() || !step.approvalStepId));

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
          <p
            className={
              unbound
                ? 'mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500'
                : 'mt-1 text-[11px] text-muted-foreground'
            }
          >
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
          <AgentBinding
            step={step}
            names={names}
            handlers={handlers}
            capabilityContext={capabilityContext}
          />
        ) : null}
        {step.kind === 'connector-query' ? (
          <ConnectorBinding
            step={step}
            names={names}
            handlers={handlers}
            capabilityContext={capabilityContext}
          />
        ) : null}
        {step.kind === 'output' ? <OutputBinding step={step} handlers={handlers} /> : null}
        {step.kind === 'action' ? (
          <ActionStepConfiguration
            step={step}
            configure={handlers.onConfigureAction}
            connectors={connectors}
            approvalSteps={approvalSteps}
            capabilityContext={capabilityContext}
          />
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

// ─── OutputBinding — pick the sink + configure its destination ────────────────────────────────────
// Each deliver-sink needs its own destination field (webhook url / Slack channel / email to+subject /
// WhatsApp number). The config editor is full-width: the sink picker + its help sit side-by-side on
// lg, and the destination inputs render below in a responsive grid. Every field maps to the pure
// setOutputConfigField reducer; a blank value clears it so an unconfigured sink degrades honestly.
function OutputBinding({
  step,
  handlers,
}: Readonly<{
  step: Extract<AppStep, { kind: 'output' }>;
  handlers: StepEditorHandlers;
}>) {
  const cfg = step.config ?? {};
  const cfgStr = (k: string): string => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '');
  const setCfg = handlers.onSetSinkConfig;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Where does the result go?</Label>
          <select
            value={step.sink}
            onChange={(e) => handlers.onSetSink(e.target.value as OutputStep['sink'])}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            aria-label="Output sink"
          >
            {SINKS.map((s) => (
              <option key={s.sink} value={s.sink} disabled={s.comingSoon}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <p className="self-end pb-1 text-[11px] text-muted-foreground">
          Every channel delivers for real and reports &ldquo;not configured&rdquo; honestly if its
          credentials aren&apos;t set up — it never fakes a send. Cloud channels (email via Resend,
          webhook, Slack) only leave the box when your pipeline&apos;s egress policy allows it, and
          PII is masked before it crosses the wire. The outcome is always recorded to the console.
        </p>
      </div>

      {setCfg ? <SinkConfigFields sink={step.sink} cfgStr={cfgStr} setCfg={setCfg} /> : null}
    </div>
  );
}

// Per-sink destination inputs. Only the fields the selected sink uses are shown.
function SinkConfigFields({
  sink,
  cfgStr,
  setCfg,
}: Readonly<{
  sink: OutputStep['sink'];
  cfgStr: (k: string) => string;
  setCfg: (key: string, value: string) => void;
}>) {
  if (sink === 'email') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField
          label="Send to (email address)"
          value={cfgStr('to')}
          placeholder="ops@corp.example"
          onChange={(v) => setCfg('to', v)}
        />
        <ConfigField
          label="Subject (optional)"
          value={cfgStr('subject')}
          placeholder="Your weekly digest"
          onChange={(v) => setCfg('subject', v)}
        />
      </div>
    );
  }
  if (sink === 'webhook') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigField
          label="Destination URL"
          value={cfgStr('url')}
          placeholder="https://hooks.your-service.com/in"
          onChange={(v) => setCfg('url', v)}
          hint="We POST a signed JSON payload (HMAC-SHA256). The signing secret lives in your vault."
        />
        <ConfigField
          label="Event name (optional)"
          value={cfgStr('event')}
          placeholder="offgrid.app_run"
          onChange={(v) => setCfg('event', v)}
        />
      </div>
    );
  }
  if (sink === 'slack') {
    return (
      <ConfigField
        label="Channel override (optional)"
        value={cfgStr('channel')}
        placeholder="#ops-alerts"
        onChange={(v) => setCfg('channel', v)}
        hint="Leave blank to use your Slack incoming-webhook's default channel. The webhook URL lives in your vault."
      />
    );
  }
  if (sink === 'whatsapp') {
    return (
      <ConfigField
        label="Send to (WhatsApp number)"
        value={cfgStr('to')}
        placeholder="+91 98765 43210"
        onChange={(v) => setCfg('to', v)}
        hint="Delivered via your on-prem WhatsApp gateway (OFFGRID_WHATSAPP_URL). Air-gapped — nothing reaches a cloud API."
      />
    );
  }
  // console / report have no destination to configure.
  return null;
}

function ConfigField({
  label,
  value,
  placeholder,
  onChange,
  hint,
}: Readonly<{
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  hint?: string;
}>) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-sm"
        aria-label={label}
      />
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function AgentBinding({
  step,
  names,
  handlers,
  capabilityContext,
}: Readonly<{
  step: Extract<AppStep, { kind: 'agent' }>;
  names: BindingNames;
  handlers: StepEditorHandlers;
  capabilityContext: BuilderSurfaceContextState;
}>) {
  const agents = names.agents ?? [];
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          Use an existing agent, or write instructions
        </Label>
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
              capabilityContext={capabilityContext}
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
  capabilityContext,
}: Readonly<{
  step: Extract<AppStep, { kind: 'connector-query' }>;
  names: BindingNames;
  handlers: StepEditorHandlers;
  capabilityContext: BuilderSurfaceContextState;
}>) {
  const domains = names.domains ?? [];
  const choices = buildBuilderCatalogueOptions(capabilityContext, {
    sliceId: 'data',
    refPrefixes: ['data:'],
    selected: step.domain
      ? [
          {
            ref: `data:${step.domain}`,
            label: domains.find((domain) => domain.id === step.domain)?.label,
          },
        ]
      : [],
  });
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        Which data source does this step read?
      </Label>
      <select
        value={step.domain}
        disabled={choices.selectionDisabled}
        onChange={(event) => handlers.onRebindDomain(event.target.value)}
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
      >
        <option value="">— pick a data source —</option>
        {choices.options.map((option) => (
          <option
            key={option.ref}
            value={option.ref.slice('data:'.length)}
            disabled={!option.selectable}
          >
            {option.label}
            {option.requiresApproval ? ' (approval required)' : ''}
            {!option.selectable ? ` (${option.statusLabel})` : ''}
          </option>
        ))}
      </select>
      {choices.guidance ? (
        <p className="text-[11px] text-muted-foreground" role="status">
          {choices.guidance}
        </p>
      ) : null}
      <UnavailableCatalogueOptions options={choices.options} />
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
  capabilityContext,
}: Readonly<{
  selected: string[];
  onChange: (refs: string[]) => void;
  capabilityContext: BuilderSurfaceContextState;
}>) {
  const choices = buildBuilderCatalogueOptions(capabilityContext, {
    sliceId: 'capabilities',
    controlId: 'select',
    refPrefixes: ['app:', 'prim:', 'tool:'],
    selected: selected.map((ref) => ({ ref })),
  });
  const apps = choices.options.filter((option) => option.ref.startsWith('app:'));
  const primitives = choices.options.filter((option) => option.ref.startsWith('prim:'));
  const registered = choices.options.filter((option) => option.ref.startsWith('tool:'));

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

      {choices.guidance ? (
        <p className="text-[11px] text-muted-foreground" role="status">
          {choices.guidance}
        </p>
      ) : null}
      <div className="space-y-3 pt-1">
        {/* 1. Your apps */}
        <ToolGroup
          icon={<AppWindow className="size-3.5" />}
          title="Your apps"
          hint="Published apps, used as building blocks."
        >
          {apps.length === 0 ? (
            <EmptyRow text="No published apps yet — publish one to reuse it here." />
          ) : (
            apps.map((option) => (
              <ToolRow key={option.ref} option={option} onToggle={() => toggle(option.ref)} />
            ))
          )}
        </ToolGroup>

        {/* 2. Primitives */}
        <ToolGroup
          icon={<PuzzlePiece className="size-3.5" />}
          title="Primitives"
          hint="Small built-in tools."
        >
          {primitives.length === 0 ? (
            <EmptyRow text="No built-in tools are available yet." />
          ) : (
            primitives.map((option) => (
              <ToolRow key={option.ref} option={option} onToggle={() => toggle(option.ref)} />
            ))
          )}
        </ToolGroup>

        {/* 3. Registered tools */}
        <ToolGroup
          icon={<Plugs className="size-3.5" />}
          title="Registered tools"
          hint="HTTP / MCP tools your org set up."
        >
          {registered.length === 0 ? (
            <EmptyRow text="No registered tools — add one under Tools." />
          ) : (
            registered.map((option) => (
              <ToolRow key={option.ref} option={option} onToggle={() => toggle(option.ref)} />
            ))
          )}
        </ToolGroup>
      </div>
    </div>
  );
}

function ToolGroup({
  icon,
  title,
  hint,
  children,
}: Readonly<{
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}>) {
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
  option,
  onToggle,
}: Readonly<{
  option: BuilderCatalogueOption;
  onToggle: () => void;
}>) {
  return (
    <div className={!option.selectable ? 'opacity-55' : ''}>
      <label
        className={
          !option.selectable && !option.removable
            ? 'flex cursor-not-allowed items-start gap-2 rounded px-1.5 py-1'
            : 'flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-muted/50'
        }
      >
        <input
          type="checkbox"
          aria-label={option.label}
          className="mt-0.5 size-3.5 shrink-0 accent-primary"
          checked={option.selected}
          disabled={!option.selectable && !option.removable}
          onChange={onToggle}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground">{option.label}</span>
            {option.requiresApproval || !option.selectable ? (
              <span className="text-[9px] text-muted-foreground">{option.statusLabel}</span>
            ) : null}
          </span>
          {option.description ? (
            <span className="block text-[11px] text-muted-foreground">{option.description}</span>
          ) : null}
          {option.requiresApproval || !option.selectable ? (
            <span className="block text-[11px] leading-relaxed text-muted-foreground">
              {option.explanation}
            </span>
          ) : null}
        </span>
      </label>
      {option.remedyHref ? (
        <Link
          href={option.remedyHref}
          className="ml-7 inline-flex min-h-11 items-center text-[11px] text-primary underline-offset-4 hover:underline"
        >
          Fix setup
        </Link>
      ) : null}
    </div>
  );
}

function UnavailableCatalogueOptions({ options }: Readonly<{ options: BuilderCatalogueOption[] }>) {
  const unavailable = options.filter((option) => !option.selectable);
  if (unavailable.length === 0) return null;
  const selected = unavailable.filter((option) => option.selected);
  const unselected = unavailable.filter((option) => !option.selected);
  const visible = [...selected, ...unselected.slice(0, Math.max(0, 3 - selected.length))];
  const visibleRefs = new Set(visible.map((option) => option.ref));
  const remaining = unavailable.filter((option) => !visibleRefs.has(option.ref));
  return (
    <div aria-label="Unavailable choices">
      <CatalogueOptionExplanations options={visible} />
      {remaining.length > 0 ? (
        <Disclosure className="mt-1">
          <DisclosureTrigger className="min-h-11 text-[11px] text-muted-foreground hover:text-foreground">
            Show {remaining.length} more
          </DisclosureTrigger>
          <DisclosureContent>
            <CatalogueOptionExplanations options={remaining} />
          </DisclosureContent>
        </Disclosure>
      ) : null}
    </div>
  );
}

function CatalogueOptionExplanations({ options }: Readonly<{ options: BuilderCatalogueOption[] }>) {
  return (
    <ul className="space-y-1 text-[11px] text-muted-foreground">
      {options.map((option) => (
        <li key={option.ref}>
          <span className="font-medium text-foreground">{option.label}:</span> {option.explanation}
          {option.remedyHref ? (
            <Link
              href={option.remedyHref}
              className="ml-1 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
            >
              Fix setup
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function EmptyRow({ text }: Readonly<{ text: string }>) {
  return <p className="px-1.5 text-[11px] text-muted-foreground">{text}</p>;
}

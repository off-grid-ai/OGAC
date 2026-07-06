'use client';

import {
  CaretDown,
  CaretUp,
  Database,
  FileText,
  Robot,
  ShieldCheck,
  Trash,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import type { AppStep, AppStepKind, OutputStep } from '@/lib/app-model';
import { describeStepBinding, type BindingNames } from '@/lib/app-builder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

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
}

const KIND_META: Record<AppStepKind, { icon: React.ReactNode; noun: string }> = {
  agent: { icon: <Robot className="size-4" />, noun: 'Agent decision' },
  'connector-query': { icon: <Database className="size-4" />, noun: 'Read from a data source' },
  guardrail: { icon: <ShieldCheck className="size-4" />, noun: 'Guardrail check' },
  human: { icon: <FileText className="size-4" />, noun: 'Human review / approve' },
  output: { icon: <FileText className="size-4" />, noun: 'Output result' },
};

const SINKS: OutputStep['sink'][] = ['console', 'report', 'email', 'whatsapp'];

export function AppStepEditor({
  step,
  index,
  total,
  names,
  handlers,
}: {
  step: AppStep;
  index: number;
  total: number;
  names: BindingNames;
  handlers: StepEditorHandlers;
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
          <AgentBinding step={step} names={names} handlers={handlers} />
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
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              report / email / whatsapp delivery lands in a later phase — the outcome is always
              recorded to the console.
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
}: {
  step: Extract<AppStep, { kind: 'agent' }>;
  names: BindingNames;
  handlers: StepEditorHandlers;
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

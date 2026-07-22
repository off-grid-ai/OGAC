'use client';

import Link from 'next/link';
import { ActionImpactSummary } from '@/components/actions/ActionImpactSummary';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionStepPatch } from '@/lib/app-builder';
import {
  confirmOnPremActionImpact,
  isActionId,
  planActionImpact,
  validateActionCommandReadiness,
} from '@/lib/action-contract';
import { isCompatibleCrmActionConnector } from '@/lib/action-connector-compatibility';
import type { AppStep } from '@/lib/app-model';
import { buildBuilderActionOptions } from '@/lib/builder-action-options';
import type { BuilderSurfaceContextState } from '@/lib/builder-surface-access';

export function ActionStepConfiguration({
  step,
  configure,
  connectors,
  approvalSteps,
  capabilityContext,
}: Readonly<{
  step: Extract<AppStep, { kind: 'action' }>;
  configure?: (patch: ActionStepPatch) => void;
  connectors: { id: string; name: string; type: string; endpoint?: string }[];
  approvalSteps: { id: string; label: string }[];
  capabilityContext: BuilderSurfaceContextState;
}>) {
  const crmConnectors = connectors.filter((connector) =>
    isCompatibleCrmActionConnector({ ...connector, endpoint: connector.endpoint ?? '' }),
  );
  const actionChoices = buildBuilderActionOptions(capabilityContext, step.actionId);
  const selectedAction = actionChoices.options.find((option) => option.selected);
  const unavailableActions = actionChoices.options.filter((option) => !option.selectable);
  const canConfigureSelectedAction = Boolean(
    configure && !actionChoices.selectionDisabled && selectedAction?.selectable,
  );
  const approval = approvalSteps.find((candidate) => candidate.id === step.approvalStepId);
  const selectedConnector = crmConnectors.find((connector) => connector.id === step.connectorId);
  const knownAction = isActionId(step.actionId);
  const plannedImpact = knownAction ? planActionImpact(step) : null;
  const impact =
    plannedImpact && selectedConnector ? confirmOnPremActionImpact(plannedImpact) : plannedImpact;
  const readiness = knownAction ? validateActionCommandReadiness(step) : { ok: false, errors: [] };

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <ActionSelect
          label="What should happen?"
          value={step.actionId}
          disabled={!configure || actionChoices.selectionDisabled}
          onChange={(value) => {
            if (isActionId(value)) configure?.({ actionId: value });
          }}
        >
          {actionChoices.options.length === 0 ? (
            <option value={step.actionId}>No actions available</option>
          ) : null}
          {actionChoices.options.map((option) => (
            <option key={option.actionId} value={option.actionId} disabled={!option.selectable}>
              {option.label}
              {option.requiresApproval ? ' (approval required)' : ''}
              {!option.selectable ? ` (${option.statusLabel})` : ''}
            </option>
          ))}
        </ActionSelect>

        <ActionSelect
          label="Which CRM connection?"
          value={step.connectorId}
          disabled={!canConfigureSelectedAction || crmConnectors.length === 0}
          onChange={(value) => configure?.({ connectorId: value })}
        >
          <option value="">Pick a CRM connection</option>
          {crmConnectors.map((connector) => (
            <option key={connector.id} value={connector.id}>
              {connector.name}
            </option>
          ))}
        </ActionSelect>

        <ActionSelect
          label="Who checks it before it runs?"
          value={step.approvalStepId ?? ''}
          disabled={!canConfigureSelectedAction || approvalSteps.length === 0}
          onChange={(value) => configure?.({ approvalStepId: value || null })}
        >
          <option value="">Pick a previous review step</option>
          {approvalSteps.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </ActionSelect>
      </div>

      {actionChoices.guidance ? (
        <p className="text-xs text-muted-foreground" role="status">
          {actionChoices.guidance}
        </p>
      ) : null}
      {selectedAction?.selectable &&
      selectedAction.requiresApproval &&
      selectedAction.approvalGuidance ? (
        <div className="border-l-2 border-primary/40 pl-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{selectedAction.approvalGuidance.heading}</p>
          <p>{selectedAction.approvalGuidance.guidance}</p>
          {selectedAction.approvalGuidance.eligibleSteps.length > 0 ? (
            <p className="mt-1">
              Available review steps:{' '}
              {selectedAction.approvalGuidance.eligibleSteps
                .map((candidate) => candidate.label)
                .join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
      {unavailableActions.length > 0 ? (
        <div className="space-y-2 border-t border-border/70 pt-3" aria-label="Unavailable actions">
          <p className="text-xs font-medium text-foreground">Not available yet</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {unavailableActions.map((option) => (
              <li key={option.actionId} className="rounded-md border border-border/70 p-2.5">
                <p className="text-xs font-medium text-foreground">{option.label}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {option.explanation}
                </p>
                {option.remedyHref ? (
                  <Link
                    href={option.remedyHref}
                    className="mt-1.5 inline-flex min-h-11 items-center text-[11px] text-primary underline-offset-4 hover:underline"
                  >
                    Fix setup
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {crmConnectors.length === 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          No approved internal CRM connection is available. Add one under Data, then return here.
        </p>
      ) : null}
      {approvalSteps.length === 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          Add a Human review step before this action. A different person must approve the change.
        </p>
      ) : null}
      {!configure ? (
        <p className="text-xs text-muted-foreground">
          Switch to Guided view to configure this action.
        </p>
      ) : null}

      {configure && !canConfigureSelectedAction ? (
        <p className="text-xs text-muted-foreground" role="status">
          This saved action stays unchanged until you choose an available action.
        </p>
      ) : null}

      {canConfigureSelectedAction && knownAction ? (
        <>
          <ActionCommandFields
            step={step}
            onCommandChange={(command) => configure?.({ command })}
          />
          {!readiness.ok ? (
            <p className="text-xs text-muted-foreground" role="alert">
              Complete the required action details above before saving.
            </p>
          ) : null}
        </>
      ) : null}

      {impact ? (
        <ActionImpactSummary
          impact={impact}
          approver={approval ? `Reviewer at "${approval.label}"` : undefined}
          evidence={['Approval decision', 'Changed CRM record', 'Signed execution receipt']}
        />
      ) : null}
    </div>
  );
}

function ActionCommandFields({
  step,
  onCommandChange,
}: Readonly<{
  step: Extract<AppStep, { kind: 'action' }>;
  onCommandChange: (command: Record<string, unknown>) => void;
}>) {
  const command = step.command;
  const set = (key: string, value: string) => {
    const next = { ...command };
    if (value.trim()) next[key] = value;
    else delete next[key];
    onCommandChange(next);
  };
  const setNested = (group: 'patch' | 'followUp', key: string, value: string) => {
    const current = objectValue(command[group]);
    const nested = { ...current };
    if (value.trim()) nested[key] = value;
    else delete nested[key];
    onCommandChange({ ...command, [group]: nested });
  };

  if (step.actionId === 'crm.create-task') {
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label="Follow-up details">
        <ActionInput
          label="Opportunity ID"
          value={textValue(command.opportunityId)}
          onChange={(v) => set('opportunityId', v)}
        />
        <ActionInput
          label="Account ID"
          value={textValue(command.accountId)}
          onChange={(v) => set('accountId', v)}
        />
        <ActionInput
          label="Follow-up title"
          value={textValue(command.subject)}
          onChange={(v) => set('subject', v)}
        />
        <ActionSelect
          label="Follow-up type"
          value={textValue(command.kind)}
          onChange={(v) => set('kind', v)}
        >
          <option value="">Pick a type</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
          <option value="review">Review</option>
        </ActionSelect>
        <ActionSelect
          label="Business purpose"
          value={textValue(command.useCase)}
          onChange={(v) => set('useCase', v)}
        >
          <option value="">Pick a purpose</option>
          <option value="bank-cross-sell">Customer opportunity</option>
          <option value="lender-delinquency">Repayment follow-up</option>
        </ActionSelect>
        <ActionInput
          label="Assign to (optional)"
          value={textValue(command.assignee)}
          onChange={(v) => set('assignee', v)}
        />
        <ActionInput
          label="Due date (optional)"
          type="datetime-local"
          value={localDateTime(command.dueAt)}
          onChange={(v) => set('dueAt', asIsoDateTime(v))}
        />
      </div>
    );
  }

  if (step.actionId === 'crm.update-task') {
    const patch = objectValue(command.patch);
    return (
      <div className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label="Task changes">
        <ActionInput
          label="CRM task ID"
          value={textValue(command.taskId)}
          onChange={(v) => set('taskId', v)}
        />
        <ActionSelect
          label="New status"
          value={textValue(patch.status)}
          onChange={(v) => setNested('patch', 'status', v)}
        >
          <option value="">Keep the current status</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </ActionSelect>
        <ActionInput
          label="New title (optional)"
          value={textValue(patch.subject)}
          onChange={(v) => setNested('patch', 'subject', v)}
        />
        <ActionInput
          label="Assign to (optional)"
          value={textValue(patch.assignee)}
          onChange={(v) => setNested('patch', 'assignee', v)}
        />
        <ActionInput
          label="New due date (optional)"
          type="datetime-local"
          value={localDateTime(patch.dueAt)}
          onChange={(v) => setNested('patch', 'dueAt', asIsoDateTime(v))}
        />
      </div>
    );
  }

  const followUp = objectValue(command.followUp);
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label="Opportunity changes">
      <ActionInput
        label="Opportunity ID"
        value={textValue(command.opportunityId)}
        onChange={(v) => set('opportunityId', v)}
      />
      <ActionInput
        label="Next action"
        value={textValue(followUp.summary)}
        onChange={(v) => setNested('followUp', 'summary', v)}
      />
      <ActionSelect
        label="Next action type"
        value={textValue(followUp.kind)}
        onChange={(v) => setNested('followUp', 'kind', v)}
      >
        <option value="">Pick a type</option>
        <option value="call">Call</option>
        <option value="email">Email</option>
        <option value="meeting">Meeting</option>
        <option value="review">Review</option>
      </ActionSelect>
      <ActionSelect
        label="Business purpose"
        value={textValue(command.useCase)}
        onChange={(v) => set('useCase', v)}
      >
        <option value="">Pick a purpose</option>
        <option value="bank-cross-sell">Customer opportunity</option>
        <option value="lender-delinquency">Repayment follow-up</option>
      </ActionSelect>
      <ActionSelect
        label="Move opportunity to (optional)"
        value={textValue(command.stage)}
        onChange={(v) => set('stage', v)}
      >
        <option value="">Keep the current stage</option>
        <option value="discovery">Discovery</option>
        <option value="qualification">Qualification</option>
        <option value="proposal">Proposal</option>
        <option value="negotiation">Negotiation</option>
        <option value="closed_won">Closed won</option>
        <option value="closed_lost">Closed lost</option>
      </ActionSelect>
      <ActionInput
        label="Assign to (optional)"
        value={textValue(followUp.assignee)}
        onChange={(v) => setNested('followUp', 'assignee', v)}
      />
      <ActionInput
        label="Due date (optional)"
        type="datetime-local"
        value={localDateTime(followUp.dueAt)}
        onChange={(v) => setNested('followUp', 'dueAt', asIsoDateTime(v))}
      />
    </div>
  );
}

function ActionInput({
  label,
  value,
  onChange,
  type = 'text',
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'datetime-local';
}>) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        aria-label={label}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9"
      />
    </div>
  );
}

function ActionSelect({
  label,
  value,
  onChange,
  children,
  disabled = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}>) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
    </div>
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function localDateTime(value: unknown): string {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 16) : '';
}

function asIsoDateTime(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

// ─── OutputBinding — pick the sink + configure its destination ────────────────────────────────────
// Each deliver-sink needs its own destination field (webhook url / Slack channel / email to+subject /
// WhatsApp number). The config editor is full-width: the sink picker + its help sit side-by-side on
// lg, and the destination inputs render below in a responsive grid. Every field maps to the pure
// setOutputConfigField reducer; a blank value clears it so an unconfigured sink degrades honestly.

import { ACTION_DESCRIPTORS, isActionId } from '@/lib/action-contract';
import type { BuilderApprovalGuidance, BuilderCapabilityItem } from '@/lib/builder-capability-view';
import type { BuilderSurfaceContextState } from '@/lib/builder-surface-access';

export interface BuilderActionOption {
  actionId: string;
  label: string;
  selectable: boolean;
  selected: boolean;
  savedOnly: boolean;
  requiresApproval: boolean;
  statusLabel: string;
  explanation: string;
  remedyHref?: string;
  approvalGuidance?: BuilderApprovalGuidance;
}

export interface BuilderActionOptions {
  options: BuilderActionOption[];
  selectionDisabled: boolean;
  guidance: string;
}

function savedOnlyOption(actionId: string): BuilderActionOption {
  return {
    actionId,
    label: isActionId(actionId)
      ? ACTION_DESCRIPTORS[actionId].label
      : 'Saved action (no longer supported)',
    selectable: false,
    selected: true,
    savedOnly: true,
    requiresApproval: false,
    statusLabel: 'Saved, but not available',
    explanation:
      'This saved action is no longer available to you. Choose another available action to replace it.',
  };
}

function optionFromItem(
  item: BuilderCapabilityItem,
  selectedActionId: string,
  canConfigure: boolean,
  sliceFailed: boolean,
  blockedByControl?: { statusLabel: string; explanation: string },
): BuilderActionOption | undefined {
  const actionId = item.ref.startsWith('action:') ? item.ref.slice('action:'.length) : '';
  if (!isActionId(actionId)) return undefined;
  const selectable = canConfigure && !sliceFailed && item.selectionState !== 'read-only';
  return {
    actionId,
    label: ACTION_DESCRIPTORS[actionId].label,
    selectable,
    selected: actionId === selectedActionId,
    savedOnly: false,
    requiresApproval: item.selectionState === 'selectable-with-approval',
    statusLabel: blockedByControl?.statusLabel ?? item.statusLabel,
    explanation: blockedByControl?.explanation ?? item.explanation,
    ...(item.remedyHref ? { remedyHref: item.remedyHref } : {}),
    ...(item.approvalGuidance ? { approvalGuidance: item.approvalGuidance } : {}),
  };
}

function unavailableGuidance(
  context: Exclude<BuilderSurfaceContextState, { status: 'ready' }>,
): string {
  return context.status === 'loading'
    ? 'Checking which actions you can add. Your saved action stays unchanged.'
    : `${context.message} Your saved action stays unchanged.`;
}

/**
 * Project the resolver-owned action catalogue into the Builder's selection model.
 *
 * ACTION_DESCRIPTORS supplies labels and command metadata only. An action is selectable only when
 * it appears in the tenant-safe resolver projection and the configure-action intent permits it.
 */
export function buildBuilderActionOptions(
  context: BuilderSurfaceContextState,
  selectedActionId: string,
): BuilderActionOptions {
  if (context.status !== 'ready') {
    return {
      options: selectedActionId ? [savedOnlyOption(selectedActionId)] : [],
      selectionDisabled: true,
      guidance: unavailableGuidance(context),
    };
  }

  const actionSlice = context.view.slices.find((slice) => slice.id === 'actions');
  const configureAction = context.view.controls.find(
    (control) => control.id === 'configure-action',
  );
  // Control-level approval has no request workflow in the Builder yet, so it cannot authorize an
  // edit. Item-level approval is different: the action can be configured now and maker-checker
  // approval is enforced when it runs.
  const canConfigure = configureAction?.state === 'enabled';
  const sliceFailed = !actionSlice || actionSlice.status === 'failed';
  const blockedByControl =
    configureAction && !canConfigure
      ? {
          statusLabel: configureAction.statusLabel,
          explanation: configureAction.explanation,
        }
      : undefined;
  const options = (actionSlice?.items ?? []).flatMap((item) => {
    const option = optionFromItem(
      item,
      selectedActionId,
      canConfigure,
      sliceFailed,
      blockedByControl,
    );
    return option ? [option] : [];
  });

  if (selectedActionId && !options.some((option) => option.actionId === selectedActionId)) {
    options.unshift(savedOnlyOption(selectedActionId));
  }

  let guidance = '';
  if (!actionSlice) {
    guidance =
      'Action choices are not available for this app yet. Your saved action stays unchanged.';
  } else if (actionSlice.status === 'failed') {
    guidance = actionSlice.explanation;
  } else if (!canConfigure) {
    guidance =
      configureAction?.explanation ??
      'You cannot change actions in this workspace. Your saved action stays unchanged.';
  } else if (!options.some((option) => option.selectable)) {
    guidance = 'No governed actions are ready to add. The next step is shown below.';
  }

  return {
    options,
    selectionDisabled: !canConfigure || sliceFailed || !options.some((option) => option.selectable),
    guidance,
  };
}

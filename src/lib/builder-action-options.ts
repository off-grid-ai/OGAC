import { ACTION_DESCRIPTORS, isActionId } from '@/lib/action-contract';
import type { BuilderApprovalGuidance } from '@/lib/builder-capability-view';
import { buildBuilderCatalogueOptions } from '@/lib/builder-catalogue-options';
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

/**
 * Add action command metadata to the shared resolver-owned catalogue projection.
 *
 * ACTION_DESCRIPTORS supplies labels and command metadata only. Resolver/control/failure/saved
 * semantics remain owned by buildBuilderCatalogueOptions so every Builder picker fails closed in
 * the same way.
 */
export function buildBuilderActionOptions(
  context: BuilderSurfaceContextState,
  selectedActionId: string,
): BuilderActionOptions {
  const catalogue = buildBuilderCatalogueOptions(context, {
    sliceId: 'actions',
    controlId: 'configure-action',
    refPrefixes: ['action:'],
    copy: { singular: 'action', plural: 'actions', verb: 'add' },
    selected: selectedActionId
      ? [
          {
            ref: `action:${selectedActionId}`,
            label: isActionId(selectedActionId)
              ? ACTION_DESCRIPTORS[selectedActionId].label
              : 'Saved action (no longer supported)',
          },
        ]
      : [],
  });
  const options = catalogue.options.flatMap((option) => {
    const actionId = option.ref.slice('action:'.length);
    if (!isActionId(actionId) && !option.savedOnly) return [];
    return [
      {
        actionId,
        label: isActionId(actionId)
          ? ACTION_DESCRIPTORS[actionId].label
          : 'Saved action (no longer supported)',
        selectable: option.selectable,
        selected: option.selected,
        savedOnly: option.savedOnly,
        requiresApproval: option.requiresApproval,
        statusLabel: option.statusLabel,
        explanation: option.explanation,
        ...(option.remedyHref ? { remedyHref: option.remedyHref } : {}),
        ...(option.approvalGuidance ? { approvalGuidance: option.approvalGuidance } : {}),
      } satisfies BuilderActionOption,
    ];
  });
  const hasSelectableAction = options.some((option) => option.selectable);

  return {
    options,
    selectionDisabled: catalogue.selectionDisabled || !hasSelectableAction,
    guidance:
      catalogue.guidance ||
      (!hasSelectableAction
        ? 'No governed actions are ready to add. The next step is shown below.'
        : ''),
  };
}

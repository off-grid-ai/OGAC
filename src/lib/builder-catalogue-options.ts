import type {
  BuilderApprovalGuidance,
  BuilderCapabilityItem,
  BuilderControlId,
} from '@/lib/builder-capability-view';
import type { BuilderSurfaceContextState } from '@/lib/builder-surface-access';

export type BuilderCatalogueSliceId = 'data' | 'capabilities' | 'pipelines' | 'actions';

export interface SavedBuilderCatalogueOption {
  ref: string;
  label?: string;
}

export interface BuilderCatalogueOption {
  ref: string;
  label: string;
  description?: string;
  scopeSummary?: string;
  selectable: boolean;
  /** A selected blocked/saved option may be removed when the picker itself is writable. */
  removable: boolean;
  selected: boolean;
  savedOnly: boolean;
  requiresApproval: boolean;
  statusLabel: string;
  explanation: string;
  remedyHref?: string;
  approvalGuidance?: BuilderApprovalGuidance;
}

export interface BuilderCatalogueOptions {
  options: BuilderCatalogueOption[];
  selectionDisabled: boolean;
  guidance: string;
}

export interface BuilderCatalogueOptionsRequest {
  sliceId: BuilderCatalogueSliceId;
  selected?: readonly SavedBuilderCatalogueOption[];
  controlId?: BuilderControlId;
  refPrefixes?: readonly string[];
  copy?: { singular: string; plural: string; verb: string };
}

const DEFAULT_COPY = { singular: 'option', plural: 'options', verb: 'use' } as const;

function savedOnlyOption(
  saved: SavedBuilderCatalogueOption,
  singular: string,
): BuilderCatalogueOption {
  return {
    ref: saved.ref,
    label: saved.label?.trim() || 'Saved option (no longer available)',
    selectable: false,
    removable: false,
    selected: true,
    savedOnly: true,
    requiresApproval: false,
    statusLabel: 'Saved, but not available',
    explanation: `This saved ${singular} is no longer available to you. Choose another available ${singular} to replace it.`,
  };
}

function matchesPrefix(ref: string, prefixes: readonly string[] | undefined): boolean {
  return !prefixes?.length || prefixes.some((prefix) => ref.startsWith(prefix));
}

function projectedOption(
  item: BuilderCapabilityItem,
  selectedRefs: ReadonlySet<string>,
  selectable: boolean,
  removable: boolean,
  blockedByControl?: { statusLabel: string; explanation: string; remedyHref?: string },
): BuilderCatalogueOption {
  return {
    ref: item.ref,
    label: item.label,
    ...(item.description ? { description: item.description } : {}),
    ...(item.scopeSummary ? { scopeSummary: item.scopeSummary } : {}),
    selectable,
    removable,
    selected: selectedRefs.has(item.ref),
    savedOnly: false,
    requiresApproval: item.selectionState === 'selectable-with-approval',
    statusLabel: blockedByControl?.statusLabel ?? item.statusLabel,
    explanation: blockedByControl?.explanation ?? item.explanation,
    ...(blockedByControl?.remedyHref || item.remedyHref
      ? { remedyHref: blockedByControl?.remedyHref ?? item.remedyHref }
      : {}),
    ...(item.approvalGuidance ? { approvalGuidance: item.approvalGuidance } : {}),
  };
}

function unavailableGuidance(
  context: Exclude<BuilderSurfaceContextState, { status: 'ready' }>,
  copy: { singular: string; plural: string; verb: string },
): string {
  return context.status === 'loading'
    ? `Checking which ${copy.plural} you can ${copy.verb}. Your saved ${copy.singular} stays unchanged.`
    : `${context.message} Your saved ${copy.singular} stays unchanged.`;
}

/**
 * Project resolver-owned slices into a shared Builder picker model.
 *
 * This function never evaluates policy. It can only tighten the resolver result when a slice or
 * control is incomplete, and it preserves saved refs without silently authorizing them.
 */
export function buildBuilderCatalogueOptions(
  context: BuilderSurfaceContextState,
  request: BuilderCatalogueOptionsRequest,
): BuilderCatalogueOptions {
  const saved = request.selected ?? [];
  const copy = request.copy ?? DEFAULT_COPY;
  const selectedRefs = new Set(saved.map((item) => item.ref));
  if (context.status !== 'ready') {
    return {
      options: saved.map((item) => savedOnlyOption(item, copy.singular)),
      selectionDisabled: true,
      guidance: unavailableGuidance(context, copy),
    };
  }

  const slice = context.view.slices.find((candidate) => candidate.id === request.sliceId);
  const control = request.controlId
    ? context.view.controls.find((candidate) => candidate.id === request.controlId)
    : undefined;
  const controlAllows = request.controlId ? control?.state === 'enabled' : true;
  const sliceFailed = !slice || slice.status === 'failed';
  const blockedByControl =
    request.controlId && !controlAllows
      ? {
          statusLabel: control?.statusLabel ?? 'Access not available',
          explanation:
            control?.explanation ?? 'This choice is not available for this workspace yet.',
          ...(control?.remedyHref ? { remedyHref: control.remedyHref } : {}),
        }
      : undefined;

  const projected = (slice?.items ?? [])
    .filter((item) => matchesPrefix(item.ref, request.refPrefixes))
    .map((item) =>
      projectedOption(
        item,
        selectedRefs,
        controlAllows && !sliceFailed && item.selectionState !== 'read-only',
        controlAllows && !sliceFailed && selectedRefs.has(item.ref),
        blockedByControl,
      ),
    );

  const savedOnly = saved
    .filter((selected) => !projected.some((option) => option.ref === selected.ref))
    .map((selected) => ({
      ...savedOnlyOption(selected, copy.singular),
      removable: controlAllows && !sliceFailed,
    }));
  const options = [...savedOnly, ...projected];

  let guidance = '';
  if (!slice) {
    guidance = `These ${copy.plural} are not available yet. Your saved ${copy.singular} stays unchanged.`;
  } else if (slice.status === 'failed') {
    guidance = slice.explanation;
  } else if (!controlAllows) {
    guidance =
      control?.explanation ??
      `You cannot change these ${copy.plural} in this workspace. Your saved ${copy.singular} stays unchanged.`;
  } else if (!options.some((option) => option.selectable)) {
    guidance = `No governed ${copy.plural} are ready to ${copy.verb}. The next step is shown below.`;
  }

  return {
    options,
    selectionDisabled:
      !controlAllows ||
      sliceFailed ||
      !options.some((option) => option.selectable || option.removable),
    guidance,
  };
}

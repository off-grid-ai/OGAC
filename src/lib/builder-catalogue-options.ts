import type {
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
  selected: boolean;
  savedOnly: boolean;
  requiresApproval: boolean;
  statusLabel: string;
  explanation: string;
  remedyHref?: string;
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
}

function savedOnlyOption(saved: SavedBuilderCatalogueOption): BuilderCatalogueOption {
  return {
    ref: saved.ref,
    label: saved.label?.trim() || 'Saved option (no longer available)',
    selectable: false,
    selected: true,
    savedOnly: true,
    requiresApproval: false,
    statusLabel: 'Saved, but not available',
    explanation:
      'This saved option is no longer available to you. Choose another available option to replace it.',
  };
}

function matchesPrefix(ref: string, prefixes: readonly string[] | undefined): boolean {
  return !prefixes?.length || prefixes.some((prefix) => ref.startsWith(prefix));
}

function projectedOption(
  item: BuilderCapabilityItem,
  selectedRefs: ReadonlySet<string>,
  selectable: boolean,
  blockedByControl?: { statusLabel: string; explanation: string; remedyHref?: string },
): BuilderCatalogueOption {
  return {
    ref: item.ref,
    label: item.label,
    ...(item.description ? { description: item.description } : {}),
    ...(item.scopeSummary ? { scopeSummary: item.scopeSummary } : {}),
    selectable,
    selected: selectedRefs.has(item.ref),
    savedOnly: false,
    requiresApproval: item.selectionState === 'selectable-with-approval',
    statusLabel: blockedByControl?.statusLabel ?? item.statusLabel,
    explanation: blockedByControl?.explanation ?? item.explanation,
    ...(blockedByControl?.remedyHref || item.remedyHref
      ? { remedyHref: blockedByControl?.remedyHref ?? item.remedyHref }
      : {}),
  };
}

function unavailableGuidance(
  context: Exclude<BuilderSurfaceContextState, { status: 'ready' }>,
): string {
  return context.status === 'loading'
    ? 'Checking which options you can use. Your saved choices stay unchanged.'
    : `${context.message} Your saved choices stay unchanged.`;
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
  const selectedRefs = new Set(saved.map((item) => item.ref));
  if (context.status !== 'ready') {
    return {
      options: saved.map(savedOnlyOption),
      selectionDisabled: true,
      guidance: unavailableGuidance(context),
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
        blockedByControl,
      ),
    );

  const savedOnly = saved
    .filter((selected) => !projected.some((option) => option.ref === selected.ref))
    .map(savedOnlyOption);
  const options = [...savedOnly, ...projected];

  let guidance = '';
  if (!slice) {
    guidance = 'These choices are not available yet. Your saved choices stay unchanged.';
  } else if (slice.status === 'failed') {
    guidance = slice.explanation;
  } else if (!controlAllows) {
    guidance =
      control?.explanation ??
      'You cannot change these choices in this workspace. Your saved choices stay unchanged.';
  } else if (!options.some((option) => option.selectable)) {
    guidance = 'No governed options are ready to add. The next step is shown below.';
  }

  return {
    options,
    selectionDisabled: !controlAllows || sliceFailed || !options.some((option) => option.selectable),
    guidance,
  };
}

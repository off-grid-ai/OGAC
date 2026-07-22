import type {
  EnterpriseCatalogSlice,
  EnterpriseContextResolution,
  ResolvedEnterpriseResource,
} from '@/lib/enterprise-context-resolver';

export type AppCapabilitySelectionKind = 'pipeline' | 'data' | 'tool' | 'action';

export interface AppCapabilitySelection {
  kind: AppCapabilitySelectionKind;
  ref: string;
}

export interface AppCapabilitySelectionInput {
  pipelineId?: unknown;
  steps?: unknown;
}

export interface AppCapabilitySelectionValidation {
  ok: boolean;
  errors: string[];
}

export const APP_CAPABILITY_SELECTION_ERROR =
  'One or more selected capabilities are not available to your account';

const ERROR_BY_KIND: Readonly<Record<AppCapabilitySelectionKind, string>> = {
  pipeline:
    'The selected governed pipeline is not available to your account. Choose one marked Ready or Approval required.',
  data:
    'A selected data source is not available to your account. Choose one marked Ready or Approval required.',
  tool: 'A selected tool is not available to your account. Choose one marked Ready or Approval required.',
  action:
    'A selected enterprise action is not available to your account. Choose one marked Ready or Approval required.',
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function addSelection(
  selections: AppCapabilitySelection[],
  seen: Set<string>,
  kind: AppCapabilitySelectionKind,
  ref: string,
): void {
  const key = `${kind}:${ref}`;
  if (seen.has(key)) return;
  seen.add(key);
  selections.push({ kind, ref });
}

/** Extract only capability references explicitly present in a create input or partial App patch. */
export function extractAppCapabilitySelections(
  input: AppCapabilitySelectionInput,
): AppCapabilitySelection[] {
  const selections: AppCapabilitySelection[] = [];
  const seen = new Set<string>();
  const pipelineId = nonEmptyString(input.pipelineId);
  if (pipelineId) addSelection(selections, seen, 'pipeline', `pipeline:${pipelineId}`);
  if (!Array.isArray(input.steps)) return selections;

  for (const value of input.steps) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const step = value as Record<string, unknown>;
    if (step.kind === 'connector-query') {
      const domain = nonEmptyString(step.domain);
      if (domain) addSelection(selections, seen, 'data', `data:${domain}`);
    }
    if (step.kind === 'agent') {
      const inlineAgent = step.inlineAgent;
      if (inlineAgent && typeof inlineAgent === 'object' && !Array.isArray(inlineAgent)) {
        const tools = (inlineAgent as Record<string, unknown>).tools;
        if (Array.isArray(tools)) {
          for (const value of tools) {
            const ref = nonEmptyString(value);
            if (ref) addSelection(selections, seen, 'tool', ref);
          }
        }
      }
    }
    if (step.kind === 'action') {
      const actionId = nonEmptyString(step.actionId);
      if (actionId) addSelection(selections, seen, 'action', `action:${actionId}`);
    }
  }
  return selections;
}

function resourceIsSelectable(
  resource: ResolvedEnterpriseResource | undefined,
  slices: ReadonlyMap<string, EnterpriseCatalogSlice>,
): boolean {
  if (!resource || slices.get(resource.sliceId)?.status === 'failed') return false;
  return resource.disposition === 'ready' || resource.disposition === 'approval-required';
}

/**
 * Validate submitted App selections against the tenant-safe resolver projection. Error messages are
 * bounded to one per capability kind and never echo a hidden or attacker-supplied identifier.
 */
export function validateAppCapabilitySelections(
  input: AppCapabilitySelectionInput,
  context: EnterpriseContextResolution,
): AppCapabilitySelectionValidation {
  const resources = new Map(context.resources.map((resource) => [resource.ref, resource]));
  const slices = new Map(context.slices.map((catalogSlice) => [catalogSlice.id, catalogSlice]));
  const rejectedKinds = new Set<AppCapabilitySelectionKind>();
  for (const selection of extractAppCapabilitySelections(input)) {
    if (!resourceIsSelectable(resources.get(selection.ref), slices)) {
      rejectedKinds.add(selection.kind);
    }
  }
  const errors = (['pipeline', 'data', 'tool', 'action'] as const)
    .filter((kind) => rejectedKinds.has(kind))
    .map((kind) => ERROR_BY_KIND[kind]);
  return { ok: errors.length === 0, errors };
}

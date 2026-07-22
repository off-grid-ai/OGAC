import type {
  EnterpriseBuilderIntent,
  EnterpriseCatalogSlice,
  EnterpriseContextResolution,
  EnterpriseIntentDecision,
  EnterpriseResourceKind,
  ResolvedEnterpriseResource,
} from '@/lib/enterprise-context-resolver';

export type BuilderSelectionState = 'selectable' | 'selectable-with-approval' | 'read-only';
export type BuilderAvailabilityKind =
  'ready' | 'approval' | 'policy-denied' | 'configuration-required' | 'dependency-unavailable';
export type BuilderControlState = 'enabled' | 'approval-required' | 'read-only' | 'unavailable';

export interface BuilderApprovalGuidance {
  kind: 'use-existing-step' | 'add-approval-step' | 'approval-required';
  heading: string;
  guidance: string;
  eligibleSteps: { ref: string; label: string }[];
}

export interface BuilderCapabilityItem {
  ref: string;
  kind: EnterpriseResourceKind;
  label: string;
  description?: string;
  scopeSummary?: string;
  selectionState: BuilderSelectionState;
  availabilityKind: BuilderAvailabilityKind;
  statusLabel: string;
  explanation: string;
  reasonCode: string;
  managementHref?: string;
  remedyHref?: string;
  approvalGuidance?: BuilderApprovalGuidance;
}

export interface BuilderCapabilitySliceView {
  id: string;
  label: string;
  status: EnterpriseCatalogSlice['status'];
  statusLabel: string;
  explanation: string;
  reasonCode: string;
  remedyHref?: string;
  items: BuilderCapabilityItem[];
  counts: {
    selectable: number;
    approvalRequired: number;
    readOnly: number;
  };
}

export type BuilderControlId =
  'create' | 'edit' | 'select' | 'configure-data' | 'configure-action' | 'publish';

export interface BuilderIntentControl {
  id: BuilderControlId;
  intent: EnterpriseBuilderIntent;
  label: string;
  state: BuilderControlState;
  statusLabel: string;
  explanation: string;
  reasonCode: string;
  remedyHref?: string;
}

export interface BuilderCapabilityView {
  policyVersion: string;
  evaluatedAt: string;
  summary: {
    ready: number;
    approvalRequired: number;
    readOnly: number;
    omitted: number;
    incompleteSlices: number;
  };
  slices: BuilderCapabilitySliceView[];
  controls: BuilderIntentControl[];
}

const CONTROL_DEFINITIONS: readonly {
  id: BuilderControlId;
  intent: EnterpriseBuilderIntent;
  label: string;
}[] = [
  { id: 'create', intent: 'build.create', label: 'Create apps' },
  { id: 'edit', intent: 'build.edit', label: 'Edit apps' },
  { id: 'select', intent: 'tool.select', label: 'Choose capabilities' },
  { id: 'configure-data', intent: 'data.configure', label: 'Set up data' },
  { id: 'configure-action', intent: 'action.configure', label: 'Set up actions' },
  { id: 'publish', intent: 'publish', label: 'Publish apps' },
];

const CONFIGURATION_REASON_CODES = new Set([
  'configuration-required',
  'config-required',
  'missing-configuration',
  'not-configured',
  'setup-required',
  'not-connected',
  'connection-required',
  'connector.not-configured',
  'connector-missing',
  'crm-connector-required',
  'tool-disabled',
  'primitive-disabled',
]);

const CONFIGURATION_REASON_PREFIXES = ['configuration.', 'config.'] as const;

function compareText(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function concise(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177).trimEnd()}…`;
}

function safeLocalHref(value: string | undefined): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return undefined;
  try {
    const base = 'https://offgrid.local';
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return undefined;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

function isConfigurationCode(reasonCode: string): boolean {
  const code = reasonCode.toLowerCase();
  return (
    CONFIGURATION_REASON_CODES.has(code) ||
    CONFIGURATION_REASON_PREFIXES.some((prefix) => code.startsWith(prefix))
  );
}

function approvalGuidance(
  resource: ResolvedEnterpriseResource,
): BuilderApprovalGuidance | undefined {
  if (resource.disposition !== 'approval-required') return undefined;
  const action = resource.action;
  if (!action?.approvalRequired) {
    return {
      kind: 'approval-required',
      heading: 'Approval required',
      guidance: 'You can add this option now. It must be approved before it can run.',
      eligibleSteps: [],
    };
  }
  const eligibleSteps = action.eligiblePriorHumanSteps.map((step) => ({ ...step }));
  if (eligibleSteps.length > 0) {
    return {
      kind: 'use-existing-step',
      heading: 'Use an existing approval step',
      guidance: 'Place one of the available human review steps before this action.',
      eligibleSteps,
    };
  }
  return {
    kind: 'add-approval-step',
    heading: 'Add an approval step',
    guidance: 'Add a human review step before this action so it can be approved before it runs.',
    eligibleSteps: [],
  };
}

function resolvedItem(resource: ResolvedEnterpriseResource): BuilderCapabilityItem {
  const managementHref = safeLocalHref(resource.managementHref);
  const remedyHref = safeLocalHref(resource.remedyHref);
  const base = {
    ref: resource.ref,
    kind: resource.kind,
    label: resource.label,
    ...(resource.description === undefined ? {} : { description: resource.description }),
    ...(resource.scopeSummary === undefined ? {} : { scopeSummary: resource.scopeSummary }),
    explanation: concise(resource.reason, 'This option is not available right now.'),
    reasonCode: resource.reasonCode,
    ...(managementHref === undefined ? {} : { managementHref }),
    ...(remedyHref === undefined ? {} : { remedyHref }),
  };

  if (resource.disposition === 'ready') {
    return {
      ...base,
      selectionState: 'selectable',
      availabilityKind: 'ready',
      statusLabel: 'Ready to add',
    };
  }
  if (resource.disposition === 'approval-required') {
    return {
      ...base,
      selectionState: 'selectable-with-approval',
      availabilityKind: 'approval',
      statusLabel: 'Needs approval',
      approvalGuidance: approvalGuidance(resource),
    };
  }
  if (resource.disposition === 'denied') {
    return {
      ...base,
      selectionState: 'read-only',
      availabilityKind: 'policy-denied',
      statusLabel: 'Not available with your access',
    };
  }
  const needsConfiguration = isConfigurationCode(resource.reasonCode);
  return {
    ...base,
    selectionState: 'read-only',
    availabilityKind: needsConfiguration ? 'configuration-required' : 'dependency-unavailable',
    statusLabel: needsConfiguration ? 'Setup needed' : 'Temporarily unavailable',
  };
}

function failedSliceItem(
  resource: ResolvedEnterpriseResource,
  slice: EnterpriseCatalogSlice,
): BuilderCapabilityItem {
  const item = resolvedItem(resource);
  return {
    ...item,
    selectionState: 'read-only',
    availabilityKind: 'dependency-unavailable',
    statusLabel: 'Section unavailable',
    explanation: concise(slice.reason, 'This section could not be loaded.'),
    reasonCode: slice.reasonCode,
    approvalGuidance: undefined,
  };
}

function sliceCopy(status: EnterpriseCatalogSlice['status']): {
  statusLabel: string;
  fallback: string;
} {
  if (status === 'failed') {
    return { statusLabel: 'Could not load', fallback: 'This section could not be loaded.' };
  }
  if (status === 'partial') {
    return {
      statusLabel: 'Some options unavailable',
      fallback: 'Available options are shown. Some options could not be loaded.',
    };
  }
  return { statusLabel: 'Available', fallback: 'This section is ready.' };
}

function buildSlice(
  slice: EnterpriseCatalogSlice,
  resources: readonly ResolvedEnterpriseResource[],
): BuilderCapabilitySliceView {
  const copy = sliceCopy(slice.status);
  const remedyHref = safeLocalHref(slice.remedyHref);
  const items = resources.map((resource) =>
    slice.status === 'failed' ? failedSliceItem(resource, slice) : resolvedItem(resource),
  );
  return {
    id: slice.id,
    label: slice.label,
    status: slice.status,
    statusLabel: copy.statusLabel,
    explanation: concise(slice.reason, copy.fallback),
    reasonCode: slice.reasonCode,
    ...(remedyHref === undefined ? {} : { remedyHref }),
    items,
    counts: {
      selectable: items.filter((item) => item.selectionState === 'selectable').length,
      approvalRequired: items.filter((item) => item.selectionState === 'selectable-with-approval')
        .length,
      readOnly: items.filter((item) => item.selectionState === 'read-only').length,
    },
  };
}

function controlFromDecision(
  definition: (typeof CONTROL_DEFINITIONS)[number],
  decision: EnterpriseIntentDecision | undefined,
): BuilderIntentControl {
  if (!decision) {
    return {
      ...definition,
      state: 'unavailable',
      statusLabel: 'Access not available',
      explanation: 'This control is not available for this workspace yet.',
      reasonCode: 'intent.not-evaluated',
    };
  }
  const remedyHref = safeLocalHref(decision.remedyHref);
  const shared = {
    ...definition,
    explanation: concise(decision.reason, 'This control is not available right now.'),
    reasonCode: decision.reasonCode,
    ...(remedyHref === undefined ? {} : { remedyHref }),
  };
  if (decision.status === 'allowed') {
    return { ...shared, state: 'enabled', statusLabel: 'Ready' };
  }
  if (decision.status === 'approval-required') {
    return { ...shared, state: 'approval-required', statusLabel: 'Needs approval' };
  }
  return { ...shared, state: 'read-only', statusLabel: 'Not available with your access' };
}

export function buildBuilderCapabilityView(
  resolution: EnterpriseContextResolution,
): BuilderCapabilityView {
  const resourcesBySlice = new Map<string, ResolvedEnterpriseResource[]>();
  for (const resource of resolution.resources) {
    const resources = resourcesBySlice.get(resource.sliceId) ?? [];
    resources.push(resource);
    resourcesBySlice.set(resource.sliceId, resources);
  }

  const declaredIds = new Set(resolution.slices.map((slice) => slice.id));
  const slices = resolution.slices.map((slice) =>
    buildSlice(slice, resourcesBySlice.get(slice.id) ?? []),
  );
  for (const sliceId of [...resourcesBySlice.keys()]
    .filter((id) => !declaredIds.has(id))
    .sort(compareText)) {
    slices.push(
      buildSlice(
        {
          id: sliceId,
          label: 'More options',
          status: 'partial',
          source: 'catalog',
          reasonCode: 'slice.not-reported',
          reason: 'Available options are shown.',
        },
        resourcesBySlice.get(sliceId) ?? [],
      ),
    );
  }

  const decisions = new Map(
    resolution.intentDecisions.map((decision) => [decision.intent, decision] as const),
  );
  const controls = CONTROL_DEFINITIONS.map((definition) =>
    controlFromDecision(definition, decisions.get(definition.intent)),
  );
  const items = slices.flatMap((slice) => slice.items);

  return {
    policyVersion: resolution.policyVersion,
    evaluatedAt: resolution.evaluatedAt,
    summary: {
      ready: items.filter((item) => item.selectionState === 'selectable').length,
      approvalRequired: items.filter((item) => item.selectionState === 'selectable-with-approval')
        .length,
      readOnly: items.filter((item) => item.selectionState === 'read-only').length,
      omitted: resolution.omittedCount,
      incompleteSlices: slices.filter((slice) => slice.status !== 'ready').length,
    },
    slices,
    controls,
  };
}

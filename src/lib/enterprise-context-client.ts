import {
  buildBuilderCapabilityView,
  type BuilderCapabilityView,
} from '@/lib/builder-capability-view';
import type {
  EnterpriseBuilderIntent,
  EnterpriseContextResolution,
  EnterpriseDecisionSource,
} from '@/lib/enterprise-context-resolver';

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DECISION_SOURCES = new Set<EnterpriseDecisionSource>([
  'tenant',
  'deployment',
  'module-access',
  'org-context',
  'catalog',
  'app-access',
  'team-access',
  'app-sharing',
  'pipeline',
  'action-policy',
]);

const BUILDER_INTENTS = new Set<EnterpriseBuilderIntent>([
  'build.create',
  'build.edit',
  'data.configure',
  'tool.select',
  'action.configure',
  'publish',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function decisionSource(value: unknown): value is EnterpriseDecisionSource {
  return typeof value === 'string' && DECISION_SOURCES.has(value as EnterpriseDecisionSource);
}

function validAction(value: unknown): boolean {
  if (value === undefined) return true;
  const action = record(value);
  return !!(
    action &&
    (action.connectorCompatibility === 'compatible' ||
      action.connectorCompatibility === 'incompatible' ||
      action.connectorCompatibility === 'unknown') &&
    typeof action.approvalRequired === 'boolean' &&
    Array.isArray(action.eligiblePriorHumanSteps) &&
    action.eligiblePriorHumanSteps.every((step) => {
      const candidate = record(step);
      return candidate && typeof candidate.ref === 'string' && typeof candidate.label === 'string';
    }) &&
    optionalString(action.impactSummary) &&
    optionalString(action.egressSummary)
  );
}

function validResource(value: unknown): boolean {
  const item = record(value);
  return !!(
    item &&
    typeof item.ref === 'string' &&
    typeof item.sliceId === 'string' &&
    (item.kind === 'data' || item.kind === 'capability' || item.kind === 'action') &&
    typeof item.label === 'string' &&
    optionalString(item.description) &&
    optionalString(item.managementHref) &&
    optionalString(item.scopeSummary) &&
    (item.disposition === 'ready' ||
      item.disposition === 'approval-required' ||
      item.disposition === 'unavailable' ||
      item.disposition === 'denied') &&
    typeof item.canSelect === 'boolean' &&
    typeof item.canUseNow === 'boolean' &&
    typeof item.requiresApproval === 'boolean' &&
    typeof item.reasonCode === 'string' &&
    typeof item.reason === 'string' &&
    optionalString(item.remedyHref) &&
    validAction(item.action)
  );
}

function validIntent(value: unknown): boolean {
  const item = record(value);
  return !!(
    item &&
    typeof item.intent === 'string' &&
    BUILDER_INTENTS.has(item.intent as EnterpriseBuilderIntent) &&
    (item.status === 'allowed' ||
      item.status === 'denied' ||
      item.status === 'approval-required') &&
    decisionSource(item.source) &&
    typeof item.reasonCode === 'string' &&
    typeof item.reason === 'string' &&
    optionalString(item.remedyHref)
  );
}

function validSlice(value: unknown): boolean {
  const item = record(value);
  return !!(
    item &&
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    (item.status === 'ready' || item.status === 'partial' || item.status === 'failed') &&
    decisionSource(item.source) &&
    typeof item.reasonCode === 'string' &&
    typeof item.reason === 'string' &&
    optionalString(item.remedyHref)
  );
}

function nonNegativeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function enterpriseResolution(value: unknown): EnterpriseContextResolution | null {
  const data = record(value);
  const actor = record(data?.actor);
  const tenant = record(data?.tenant);
  const summary = record(data?.summary);
  if (
    !data ||
    typeof data.policyVersion !== 'string' ||
    typeof data.evaluatedAt !== 'string' ||
    !actor ||
    typeof actor.actorId !== 'string' ||
    (actor.principalKind !== 'user' && actor.principalKind !== 'machine') ||
    typeof actor.role !== 'string' ||
    typeof actor.baseRole !== 'string' ||
    !strings(actor.departments) ||
    !strings(actor.teams) ||
    !tenant ||
    typeof tenant.effectiveOrgId !== 'string' ||
    (tenant.requestedOrgId !== null && typeof tenant.requestedOrgId !== 'string') ||
    !Array.isArray(data.resources) ||
    !data.resources.every(validResource) ||
    !nonNegativeNumber(data.omittedCount) ||
    !Array.isArray(data.intentDecisions) ||
    !data.intentDecisions.every(validIntent) ||
    !Array.isArray(data.allowedIntents) ||
    !data.allowedIntents.every(
      (intent) =>
        typeof intent === 'string' && BUILDER_INTENTS.has(intent as EnterpriseBuilderIntent),
    ) ||
    !Array.isArray(data.slices) ||
    !data.slices.every(validSlice) ||
    !summary ||
    !['visible', 'omitted', 'ready', 'approvalRequired', 'unavailable', 'denied'].every((key) =>
      nonNegativeNumber(summary[key]),
    )
  ) {
    return null;
  }
  return data as unknown as EnterpriseContextResolution;
}

export function parseEnterpriseContextEnvelope(payload: unknown): EnterpriseContextResolution {
  const envelope = record(payload);
  const resolution =
    envelope?.object === 'enterprise_context' ? enterpriseResolution(envelope.data) : null;
  if (!resolution) throw new Error('The available options response was incomplete. Try again.');
  return resolution;
}

function contextUrl(appId?: string): string {
  if (!appId) return '/api/v1/admin/enterprise-context';
  const query = new URLSearchParams({ appId });
  return `/api/v1/admin/enterprise-context?${query.toString()}`;
}

export async function loadBuilderCapabilityContext(
  fetchImpl: Fetch,
  appId?: string,
  signal?: AbortSignal,
): Promise<BuilderCapabilityView> {
  const response = await fetchImpl(contextUrl(appId), { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Available options could not be loaded. Try again.');
  const payload = (await response.json().catch(() => null)) as unknown;
  return buildBuilderCapabilityView(parseEnterpriseContextEnvelope(payload));
}

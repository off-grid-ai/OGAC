// Enterprise Context and Permission Resolver — pure contract + deterministic projection.
//
// This module does not evaluate tenancy, RBAC/ABAC, sharing, pipeline, or action policy. Their
// existing owners supply authoritative facts; this resolver only produces one safe, serializable
// view for builders and other nontechnical consumers. No database, auth, network, or UI imports.

export type EnterpriseResourceKind = 'data' | 'capability' | 'action';
export type EnterpriseDisposition = 'denied' | 'unavailable' | 'approval-required' | 'ready';
export type EnterpriseDecisionSource =
  | 'tenant'
  | 'deployment'
  | 'module-access'
  | 'org-context'
  | 'catalog'
  | 'app-access'
  | 'team-access'
  | 'app-sharing'
  | 'pipeline'
  | 'action-policy';

export interface EnterpriseDecisionExplanation {
  source: EnterpriseDecisionSource;
  /** Stable machine-readable code owned by the authoritative source. */
  reasonCode: string;
  /** Plain-language explanation safe to show to a nontechnical user. */
  reason: string;
  remedyHref?: string;
}

export interface EnterpriseVisibilityFact extends EnterpriseDecisionExplanation {
  status: 'visible' | 'hidden';
}

export interface EnterpriseAvailabilityFact extends EnterpriseDecisionExplanation {
  status: 'available' | 'unavailable';
}

export interface EnterpriseAuthorizationFact extends EnterpriseDecisionExplanation {
  status: 'allowed' | 'denied' | 'approval-required';
}

/** Additional runtime/governance gates may only tighten an authoritative authorization. */
export interface EnterpriseConstraintFact extends EnterpriseDecisionExplanation {
  status: 'denied' | 'approval-required';
}

export interface EligibleHumanStep {
  ref: string;
  label: string;
}

/** Supplied action facts; no connector, graph, approval, impact, or egress rule is evaluated here. */
export interface EnterpriseActionProjection {
  connectorCompatibility: 'compatible' | 'incompatible' | 'unknown';
  approvalRequired: boolean;
  eligiblePriorHumanSteps: readonly EligibleHumanStep[];
  impactSummary?: string;
  egressSummary?: string;
}

export interface EnterpriseResourceCandidate {
  ref: string;
  /** Catalog slice that owns this item (for grouping and partial-state attribution). */
  sliceId: string;
  kind: EnterpriseResourceKind;
  label: string;
  description?: string;
  managementHref?: string;
  scopeSummary?: string;
  orgId: string;
  visibility: EnterpriseVisibilityFact;
  availability: EnterpriseAvailabilityFact;
  authorization: EnterpriseAuthorizationFact;
  constraints?: readonly EnterpriseConstraintFact[];
  action?: EnterpriseActionProjection;
}

export type EnterpriseBuilderIntent =
  'build.create' | 'build.edit' | 'data.configure' | 'tool.select' | 'action.configure' | 'publish';

export interface EnterpriseIntentDecision extends EnterpriseDecisionExplanation {
  intent: EnterpriseBuilderIntent;
  status: 'allowed' | 'denied' | 'approval-required';
}

export interface EnterpriseCatalogSlice extends EnterpriseDecisionExplanation {
  id: string;
  label: string;
  status: 'ready' | 'partial' | 'failed';
}

export interface EnterpriseActorContext {
  actorId: string;
  principalKind: 'user' | 'machine';
  role: string;
  baseRole: string;
  departments: readonly string[];
  teams: readonly string[];
}

export interface EnterpriseTenantContext {
  effectiveOrgId: string;
  requestedOrgId?: string | null;
}

export interface EnterpriseContextResolverInput {
  policyVersion: string;
  evaluatedAt: string;
  actor: EnterpriseActorContext;
  tenant: EnterpriseTenantContext;
  resources: readonly EnterpriseResourceCandidate[];
  intentDecisions: readonly EnterpriseIntentDecision[];
  slices: readonly EnterpriseCatalogSlice[];
}

export interface ResolvedEnterpriseResource {
  ref: string;
  sliceId: string;
  kind: EnterpriseResourceKind;
  label: string;
  description?: string;
  managementHref?: string;
  scopeSummary?: string;
  disposition: EnterpriseDisposition;
  canSelect: boolean;
  canUseNow: boolean;
  requiresApproval: boolean;
  reasonCode: string;
  reason: string;
  remedyHref?: string;
  action?: EnterpriseActionProjection;
}

export interface EnterpriseContextResolution {
  policyVersion: string;
  evaluatedAt: string;
  actor: EnterpriseActorContext;
  tenant: Required<EnterpriseTenantContext>;
  resources: ResolvedEnterpriseResource[];
  /** Hidden and cross-tenant resource identities are deliberately not returned. */
  omittedCount: number;
  intentDecisions: EnterpriseIntentDecision[];
  allowedIntents: EnterpriseBuilderIntent[];
  slices: EnterpriseCatalogSlice[];
  summary: {
    visible: number;
    omitted: number;
    ready: number;
    approvalRequired: number;
    unavailable: number;
    denied: number;
  };
}

const KIND_ORDER: Readonly<Record<EnterpriseResourceKind, number>> = {
  data: 0,
  capability: 1,
  action: 2,
};

const SOURCE_ORDER: Readonly<Record<EnterpriseDecisionSource, number>> = {
  tenant: 0,
  deployment: 1,
  'module-access': 2,
  'org-context': 3,
  catalog: 4,
  'app-access': 5,
  'team-access': 6,
  'app-sharing': 7,
  pipeline: 8,
  'action-policy': 9,
};

function compareText(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareExplanation(
  left: EnterpriseDecisionExplanation,
  right: EnterpriseDecisionExplanation,
): number {
  return (
    SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source] ||
    compareText(left.reasonCode, right.reasonCode) ||
    compareText(left.reason, right.reason)
  );
}

function copyExplanation<T extends EnterpriseDecisionExplanation>(value: T): T {
  return { ...value };
}

function copyAction(
  action: EnterpriseActionProjection | undefined,
): EnterpriseActionProjection | undefined {
  if (!action) return undefined;
  return {
    ...action,
    eligiblePriorHumanSteps: action.eligiblePriorHumanSteps.map((step) => ({ ...step })),
  };
}

function primaryDecision(candidate: EnterpriseResourceCandidate): {
  disposition: EnterpriseDisposition;
  explanation: EnterpriseDecisionExplanation;
} {
  const denied = [
    ...(candidate.authorization.status === 'denied' ? [candidate.authorization] : []),
    ...(candidate.constraints ?? []).filter((constraint) => constraint.status === 'denied'),
  ].sort(compareExplanation);
  if (denied[0]) return { disposition: 'denied', explanation: denied[0] };

  if (candidate.availability.status === 'unavailable') {
    return { disposition: 'unavailable', explanation: candidate.availability };
  }

  const approval = [
    ...(candidate.authorization.status === 'approval-required' ? [candidate.authorization] : []),
    ...(candidate.constraints ?? []).filter(
      (constraint) => constraint.status === 'approval-required',
    ),
  ].sort(compareExplanation);
  if (approval[0]) return { disposition: 'approval-required', explanation: approval[0] };

  return { disposition: 'ready', explanation: candidate.authorization };
}

function resolveResource(candidate: EnterpriseResourceCandidate): ResolvedEnterpriseResource {
  const { disposition, explanation } = primaryDecision(candidate);
  return {
    ref: candidate.ref,
    sliceId: candidate.sliceId,
    kind: candidate.kind,
    label: candidate.label,
    ...(candidate.description === undefined ? {} : { description: candidate.description }),
    ...(candidate.managementHref === undefined ? {} : { managementHref: candidate.managementHref }),
    ...(candidate.scopeSummary === undefined ? {} : { scopeSummary: candidate.scopeSummary }),
    disposition,
    canSelect: disposition === 'ready' || disposition === 'approval-required',
    canUseNow: disposition === 'ready',
    requiresApproval: disposition === 'approval-required',
    reasonCode: explanation.reasonCode,
    reason: explanation.reason,
    ...(explanation.remedyHref === undefined ? {} : { remedyHref: explanation.remedyHref }),
    ...(candidate.action === undefined ? {} : { action: copyAction(candidate.action) }),
  };
}

const INTENT_STATUS_ORDER: Readonly<Record<EnterpriseIntentDecision['status'], number>> = {
  denied: 0,
  'approval-required': 1,
  allowed: 2,
};

function resolveIntentDecisions(
  facts: readonly EnterpriseIntentDecision[],
): EnterpriseIntentDecision[] {
  const decisiveByIntent = new Map<EnterpriseBuilderIntent, EnterpriseIntentDecision>();
  for (const fact of facts) {
    const current = decisiveByIntent.get(fact.intent);
    const factWins =
      !current ||
      INTENT_STATUS_ORDER[fact.status] < INTENT_STATUS_ORDER[current.status] ||
      (fact.status === current.status && compareExplanation(fact, current) < 0);
    if (factWins) decisiveByIntent.set(fact.intent, copyExplanation(fact));
  }
  return [...decisiveByIntent.values()].sort((left, right) =>
    compareText(left.intent, right.intent),
  );
}

/**
 * Produce the safe enterprise context projection from facts resolved by the existing policy owners.
 * Security precedence: hidden/cross-tenant omitted; denied > unavailable > approval-required > ready.
 */
export function resolveEnterpriseContext(
  input: EnterpriseContextResolverInput,
): EnterpriseContextResolution {
  let omittedCount = 0;
  const resources: ResolvedEnterpriseResource[] = [];
  for (const candidate of input.resources) {
    if (
      candidate.orgId !== input.tenant.effectiveOrgId ||
      candidate.visibility.status === 'hidden'
    ) {
      omittedCount += 1;
      continue;
    }
    resources.push(resolveResource(candidate));
  }
  resources.sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      compareText(left.label, right.label) ||
      compareText(left.ref, right.ref),
  );

  const intentDecisions = resolveIntentDecisions(input.intentDecisions);
  const allowedIntents = intentDecisions
    .filter((decision) => decision.status === 'allowed')
    .map((decision) => decision.intent);
  const slices = input.slices
    .map(copyExplanation)
    .sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));

  const count = (disposition: EnterpriseDisposition): number =>
    resources.filter((resource) => resource.disposition === disposition).length;

  return {
    policyVersion: input.policyVersion,
    evaluatedAt: input.evaluatedAt,
    actor: {
      ...input.actor,
      departments: [...input.actor.departments].sort(compareText),
      teams: [...input.actor.teams].sort(compareText),
    },
    tenant: {
      effectiveOrgId: input.tenant.effectiveOrgId,
      requestedOrgId: input.tenant.requestedOrgId ?? null,
    },
    resources,
    omittedCount,
    intentDecisions,
    allowedIntents,
    slices,
    summary: {
      visible: resources.length,
      omitted: omittedCount,
      ready: count('ready'),
      approvalRequired: count('approval-required'),
      unavailable: count('unavailable'),
      denied: count('denied'),
    },
  };
}

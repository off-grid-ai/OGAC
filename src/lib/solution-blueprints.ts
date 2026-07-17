import type { AppSpec, AppStep } from '@/lib/app-model';
import type { OutcomeContract } from '@/lib/outcome-contract';
import { validateOutcomeContract } from '@/lib/outcome-contract';
import type { PipelineView } from '@/lib/pipelines';
import { computeRoi, type RoiResult } from '@/lib/roi';

export type BlueprintEvidenceStatus = 'unverified' | 'verified';

/** Evidence attached to a reusable benchmark, never inferred from a seed or a deployment count. */
export interface BlueprintProof {
  status: BlueprintEvidenceStatus;
  summary: string;
  evidenceLinks: string[];
}

/** Immutable snapshot. Editing a blueprint appends one of these and advances currentVersion. */
export interface SolutionBlueprintVersion {
  blueprintId: string;
  orgId: string;
  version: number;
  title: string;
  summary: string;
  industry: string;
  process: string;
  businessOwner: string;
  requiredDataDomains: string[];
  requiredCapabilities: BlueprintCapability[];
  requiredPipelineName: string;
  sourceTemplateKey: string;
  /** False for a catalog hypothesis that has no verified App/template/pipeline asset yet. */
  adoptable: boolean;
  outcome: OutcomeContract;
  proof: BlueprintProof;
  createdBy: string;
  createdAt: Date;
}

/** Stable catalog identity plus the currently selected immutable version. */
export interface SolutionBlueprint extends SolutionBlueprintVersion {
  id: string;
  currentVersion: number;
  sourceCatalogKey: string | null;
  catalogVersion: number | null;
  tombstonedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SolutionBlueprintInput = Omit<
  SolutionBlueprintVersion,
  'blueprintId' | 'orgId' | 'version' | 'createdBy' | 'createdAt'
>;

export type BlueprintCapability = 'grounded-inference' | 'human-approval' | 'report-output';

export interface CompatibilityResult {
  compatible: boolean;
  errors: string[];
  pipelineId: string | null;
}

/**
 * Persisted Apps predate the current flat AppStep contract: production seed rows keep step-specific
 * fields under `config`. Normalize that untyped JSONB at the solution boundary so compatibility is
 * fail-closed and deterministic instead of trusting a TypeScript cast over legacy data.
 */
export function normalizeCompatibilityApp(
  value: unknown,
): Pick<AppSpec, 'pipelineId' | 'published' | 'steps'> {
  const app = record(value);
  const rawSteps = Array.isArray(app.steps) ? app.steps : [];
  const steps = rawSteps.flatMap((value, index): AppStep[] => {
    const step = record(value);
    const config = record(step.config);
    const kind = text(step.kind);
    const id = text(step.id) || `legacy-step-${index + 1}`;
    const label = text(step.label);
    if (kind === 'connector-query') {
      return [{ id, label, kind, domain: text(step.domain) || text(config.domain) }];
    }
    if (kind === 'agent') {
      const inline = record(step.inlineAgent ?? config.inlineAgent);
      const inlineAgent = Object.keys(inline).length
        ? {
            systemPrompt: text(inline.systemPrompt),
            grounded: inline.grounded === true,
          }
        : undefined;
      return [{ id, label, kind, agentId: text(step.agentId) || undefined, inlineAgent }];
    }
    if (kind === 'human') return [{ id, label, kind }];
    if (kind === 'guardrail') return [{ id, label, kind }];
    if (kind === 'output') {
      const sink = text(step.sink) || text(config.sink);
      return [
        {
          id,
          label,
          kind,
          sink: sink === 'report' || sink === 'email' || sink === 'whatsapp' ? sink : 'console',
        },
      ];
    }
    return [];
  });
  return {
    pipelineId: text(app.pipelineId) || null,
    published: app.published === true,
    steps,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface SolutionDeployment {
  id: string;
  orgId: string;
  blueprintId: string;
  /** The immutable definition this tenant adopted. */
  blueprintVersion: number;
  appId: string;
  /** Exact runtime binding verified at activation time and checked again before every run. */
  pipelineId: string;
  status: 'active' | 'paused' | 'retired';
  activatedAt: Date;
  /** End of the current evidence interval while paused; null while active or permanently retired. */
  pausedAt: Date | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SolutionDeploymentInput = Pick<
  SolutionDeployment,
  'blueprintId' | 'blueprintVersion' | 'appId' | 'status'
>;

/**
 * Append-only operator claim scoped to one deployment and evidence window. Run counts and AI cost
 * are deliberately absent: the store derives those facts from canonical app_runs evidence.
 */
export interface SolutionObservationInput {
  windowStart: Date;
  windowEnd: Date;
  claimedMetricValue: number;
  claimLabel: string;
  estimatedMinutesSavedPerRun: number;
  estimatedLoadedCostPerHour: number;
  evidenceLinks: string[];
}

export interface SolutionObservation extends SolutionObservationInput {
  id: string;
  orgId: string;
  deploymentId: string;
  /** Immutable canonical run ids whose completed results fall in this observation window. */
  runIds: string[];
  /** Derived from completed canonical app_runs, never entered by an operator. */
  runsCompleted: number;
  /** Derived from the canonical run/FinOps cost fields, never entered by an operator. */
  actualAiCost: number;
  createdBy: string;
  createdAt: Date;
  /** Estimate over measured run facts plus the explicitly labelled labor assumptions. */
  estimatedRoi: RoiResult;
}

function nonEmptyList(values: string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().length > 0);
}

export function validEvidenceLinks(links: string[]): boolean {
  return links.every((link) => link.startsWith('/') || /^https?:\/\//.test(link));
}

export function validateBlueprint(input: SolutionBlueprintInput): string[] {
  const errors: string[] = [];
  const required = [
    ['title', input.title],
    ['summary', input.summary],
    ['industry', input.industry],
    ['process', input.process],
    ['business owner', input.businessOwner],
    ['required pipeline name', input.requiredPipelineName],
    ['source template key', input.sourceTemplateKey],
  ] as const;
  for (const [label, value] of required) if (!value.trim()) errors.push(`${label} is required`);
  if (!nonEmptyList(input.requiredDataDomains)) errors.push('at least one data domain is required');
  if (!nonEmptyList(input.requiredCapabilities)) errors.push('at least one capability is required');
  if (typeof input.adoptable !== 'boolean') errors.push('adoptable must be true or false');
  if (
    input.requiredCapabilities.some(
      (capability) =>
        !['grounded-inference', 'human-approval', 'report-output'].includes(capability),
    )
  ) {
    errors.push('invalid required capability');
  }
  if (!['unverified', 'verified'].includes(input.proof.status)) errors.push('invalid proof status');
  if (input.proof.status === 'verified' && !input.proof.summary.trim()) {
    errors.push('verified proof requires a summary');
  }
  if (input.proof.status === 'verified' && input.proof.evidenceLinks.length === 0) {
    errors.push('verified proof requires evidence');
  }
  if (!validEvidenceLinks(input.proof.evidenceLinks)) {
    errors.push('evidence links must be relative or HTTP URLs');
  }
  if (input.outcome.measured) {
    errors.push('measured KPI belongs to deployment observations, not a reusable blueprint');
  }
  return [...errors, ...validateOutcomeContract({ ...input.outcome, measured: null })];
}

export function validateDeployment(input: SolutionDeploymentInput): string[] {
  const errors: string[] = [];
  if (!input.blueprintId.trim()) errors.push('blueprint is required');
  if (!Number.isInteger(input.blueprintVersion) || input.blueprintVersion < 1) {
    errors.push('blueprint version must be a positive integer');
  }
  if (!input.appId.trim()) errors.push('app is required');
  if (!['active', 'paused', 'retired'].includes(input.status)) {
    errors.push('invalid deployment status');
  }
  return errors;
}

export function validateObservation(
  input: SolutionObservationInput,
  now: Date = new Date(),
): string[] {
  const errors: string[] = [];
  if (!(input.windowStart instanceof Date) || !Number.isFinite(input.windowStart.valueOf())) {
    errors.push('window start must be a valid date');
  }
  if (!(input.windowEnd instanceof Date) || !Number.isFinite(input.windowEnd.valueOf())) {
    errors.push('window end must be a valid date');
  }
  if (
    input.windowStart instanceof Date &&
    input.windowEnd instanceof Date &&
    input.windowEnd <= input.windowStart
  ) {
    errors.push('window end must be after window start');
  }
  if (
    input.windowEnd instanceof Date &&
    Number.isFinite(input.windowEnd.valueOf()) &&
    input.windowEnd > now
  ) {
    errors.push('window end cannot be in the future');
  }
  if (!Number.isFinite(input.claimedMetricValue))
    errors.push('claimed metric value must be finite');
  if (!input.claimLabel.trim()) errors.push('claim label is required');
  for (const [label, value] of [
    ['estimated minutes saved per run', input.estimatedMinutesSavedPerRun],
    ['estimated loaded cost per hour', input.estimatedLoadedCostPerHour],
  ] as const) {
    if (!Number.isFinite(value) || value < 0)
      errors.push(`${label} must be finite and non-negative`);
  }
  if (input.evidenceLinks.length === 0) errors.push('operator claims require supporting evidence');
  if (!validEvidenceLinks(input.evidenceLinks)) {
    errors.push('evidence links must be relative or HTTP URLs');
  }
  return errors;
}

function canonical(value: unknown): string {
  return text(value).toLocaleLowerCase();
}

export function capabilitiesForSteps(steps: AppStep[]): Set<BlueprintCapability> {
  const capabilities = new Set<BlueprintCapability>();
  for (const step of steps) {
    if (step.kind === 'agent' && (step.agentId || step.inlineAgent?.grounded)) {
      capabilities.add('grounded-inference');
    }
    if (step.kind === 'human') capabilities.add('human-approval');
    if (step.kind === 'output' && step.sink === 'report') capabilities.add('report-output');
  }
  return capabilities;
}

/**
 * Pure, fail-closed deployment contract. It checks the actual App graph and the exact published
 * pipeline that the App runtime consumes; free-text metadata is never enough to activate a solution.
 */
export function evaluateSolutionCompatibility(
  blueprint: Pick<
    SolutionBlueprint,
    | 'tombstonedAt'
    | 'adoptable'
    | 'requiredDataDomains'
    | 'requiredCapabilities'
    | 'requiredPipelineName'
  >,
  app: Pick<AppSpec, 'pipelineId' | 'published' | 'steps'>,
  pipeline: Pick<PipelineView, 'id' | 'name' | 'status' | 'dataAllowlist'> | null,
): CompatibilityResult {
  const errors: string[] = [];
  if (blueprint.tombstonedAt) errors.push('blueprint is retired');
  if (!blueprint.adoptable)
    errors.push('blueprint is a hypothesis and has no adoptable runtime asset');
  if (!app.published) errors.push('App must be published');
  if (!app.pipelineId) errors.push('App has no explicit governed pipeline binding');
  if (!pipeline) errors.push('bound pipeline does not exist');
  if (pipeline && app.pipelineId !== pipeline.id) errors.push('pipeline binding changed');
  if (pipeline && pipeline.status !== 'published') errors.push('bound pipeline must be published');
  if (pipeline && canonical(pipeline.name) !== canonical(blueprint.requiredPipelineName)) {
    errors.push(`requires pipeline ${blueprint.requiredPipelineName}`);
  }

  const appDomains = new Set(
    app.steps
      .filter(
        (step): step is Extract<AppStep, { kind: 'connector-query' }> =>
          step.kind === 'connector-query',
      )
      .map((step) => canonical(step.domain)),
  );
  const ceiling = new Set((pipeline?.dataAllowlist ?? []).map(canonical));
  for (const required of blueprint.requiredDataDomains) {
    const token = canonical(required);
    if (!appDomains.has(token)) errors.push(`App graph does not read required domain: ${required}`);
    if (!ceiling.has(token)) errors.push(`pipeline does not allow required domain: ${required}`);
  }

  const capabilities = capabilitiesForSteps(app.steps);
  for (const required of blueprint.requiredCapabilities) {
    if (!capabilities.has(required)) errors.push(`App graph lacks capability: ${required}`);
  }
  return { compatible: errors.length === 0, errors, pipelineId: app.pipelineId ?? null };
}

export function withEstimatedRoi(
  observation: Omit<SolutionObservation, 'estimatedRoi'>,
): SolutionObservation {
  return {
    ...observation,
    estimatedRoi: computeRoi({
      runsCompleted: observation.runsCompleted,
      minutesSavedPerRun: observation.estimatedMinutesSavedPerRun,
      loadedCostPerHour: observation.estimatedLoadedCostPerHour,
      actualAiCost: observation.actualAiCost,
    }),
  };
}

export function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

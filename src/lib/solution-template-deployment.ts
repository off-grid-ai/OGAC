import type { ActionId } from '@/lib/action-contract';
import { isCompatibleCrmActionConnector } from '@/lib/action-connector-compatibility';
import type { AppSpec, AppStep } from '@/lib/app-model';
import {
  cloneApp,
  deleteApp,
  getTemplate,
  getTemplateSourceSpec,
  publishApp,
  updateApp,
  type TemplateView,
} from '@/lib/apps-store';
import { resolveDomain, type DataDomain } from '@/lib/data-domains';
import { listDomains } from '@/lib/data-domains-store';
import { validateEnterpriseAppSelections } from '@/lib/enterprise-context';
import {
  createSolutionDeployment,
  getSolutionBlueprint,
} from '@/lib/solution-blueprints-store';
import type { SolutionDeployment } from '@/lib/solution-blueprints';
import { listConnectors } from '@/lib/store';

export interface SolutionTemplateDeploymentRequest {
  blueprintVersion: number;
  templateId: string;
  pipelineId: string;
  title?: string;
  values: Record<string, string>;
  /** Optional when the tenant has exactly one compatible CRM connection. */
  actionConnectorId?: string;
}

export interface SolutionActionRequirement {
  stepId: string;
  label: string;
  actionId: ActionId;
  connectorId: string;
  approvalStepId: string;
}

export interface SolutionAppRequirements {
  dataDomains: string[];
  actions: SolutionActionRequirement[];
}

export interface SolutionDeploymentReceipt {
  deploymentId: string;
  appId: string;
  blueprintId: string;
  blueprintVersion: number;
  templateId: string;
  pipelineId: string;
  status: SolutionDeployment['status'];
  appHref: string;
  appTitle: string;
  requirements: SolutionAppRequirements;
}

export class SolutionTemplateDeploymentError extends Error {
  readonly code:
    | 'not-found'
    | 'template-mismatch'
    | 'capability-denied'
    | 'action-connector-required'
    | 'cleanup-failed';
  readonly errors: string[];

  constructor(
    message: string,
    code: SolutionTemplateDeploymentError['code'],
    errors: string[] = [],
  ) {
    super(message);
    this.name = 'SolutionTemplateDeploymentError';
    this.code = code;
    this.errors = errors;
  }
}

export interface SolutionDeploymentActor {
  userId: string;
  role?: string;
}

/** A Blueprint registers one exact published template identity, never a fuzzy title match. */
export function registeredTemplateMatches(
  sourceTemplateKey: string,
  template: Pick<TemplateView, 'id' | 'slug'>,
): boolean {
  const key = sourceTemplateKey.trim();
  return key.length > 0 && (key === template.id || key === template.slug);
}

export function solutionAppRequirements(app: Pick<AppSpec, 'steps'>): SolutionAppRequirements {
  const dataDomains = Array.from(
    new Set(
      app.steps
        .filter(
          (step): step is Extract<AppStep, { kind: 'connector-query' }> =>
            step.kind === 'connector-query',
        )
        .map((step) => step.domain.trim())
        .filter(Boolean),
    ),
  );
  const actions = app.steps
    .filter((step): step is Extract<AppStep, { kind: 'action' }> => step.kind === 'action')
    .map((step) => ({
      stepId: step.id,
      label: step.label,
      actionId: step.actionId,
      connectorId: step.connectorId,
      approvalStepId: step.approvalStepId ?? '',
    }));
  return { dataDomains, actions };
}

export function bindSolutionActionConnector(app: AppSpec, connectorId: string): AppSpec {
  return {
    ...app,
    steps: app.steps.map((step) =>
      step.kind === 'action' ? { ...step, connectorId } : structuredClone(step),
    ),
  };
}

/** Compensation is allowed only for the new tenant-owned identity returned by the clone boundary. */
export function isCompensableSolutionClone(
  source: Pick<AppSpec, 'id'>,
  targetOrgId: string,
  clone: Pick<AppSpec, 'id' | 'orgId'>,
): boolean {
  return clone.id !== source.id && clone.orgId === targetOrgId;
}

/**
 * The App runtime accepts a data-domain id, label or alias; the Enterprise Context catalogue uses
 * canonical ids. Project only the policy check to ids while preserving the human-readable runtime
 * graph that the Blueprint compatibility contract already pins.
 */
export function capabilitySelectionProjection(app: AppSpec, domains: DataDomain[]): AppSpec {
  return {
    ...app,
    steps: app.steps.map((step) => {
      if (step.kind !== 'connector-query') return structuredClone(step);
      const exact = domains.find((domain) => domain.id === step.domain.trim());
      const domain = exact ?? resolveDomain(step.domain, domains);
      return domain ? { ...step, domain: domain.id } : { ...step };
    }),
  };
}

function actionConnectorFor(
  app: AppSpec,
  requestedId: string | undefined,
  connectors: Awaited<ReturnType<typeof listConnectors>>,
): string | null {
  if (!app.steps.some((step) => step.kind === 'action')) return null;
  const compatible = connectors.filter(isCompatibleCrmActionConnector);
  if (requestedId) {
    return compatible.some((connector) => connector.id === requestedId) ? requestedId : null;
  }
  return compatible.length === 1 ? compatible[0].id : null;
}

/**
 * Compose the existing template, App, enterprise-context and SolutionDeployment owners. This is a
 * use-case seam, not another runtime: the resulting instance is the canonical AppSpec and every run
 * remains guarded by the existing pinned SolutionDeployment contract.
 */
export async function deployRegisteredSolutionTemplate(
  blueprintId: string,
  orgId: string,
  actor: SolutionDeploymentActor,
  request: SolutionTemplateDeploymentRequest,
): Promise<SolutionDeploymentReceipt> {
  const [blueprint, template, source] = await Promise.all([
    getSolutionBlueprint(blueprintId, orgId, request.blueprintVersion),
    getTemplate(request.templateId, orgId),
    getTemplateSourceSpec(request.templateId, orgId),
  ]);
  if (!blueprint) {
    throw new SolutionTemplateDeploymentError(
      'The selected solution version is not available in your organization',
      'not-found',
    );
  }
  if (!template || !source) {
    throw new SolutionTemplateDeploymentError(
      'The registered template is not available to your organization',
      'not-found',
    );
  }
  if (!registeredTemplateMatches(blueprint.sourceTemplateKey, template)) {
    throw new SolutionTemplateDeploymentError(
      'This template is not registered to the selected solution',
      'template-mismatch',
    );
  }

  let createdAppId: string | null = null;
  let deploymentCreated = false;
  try {
    const clone = await cloneApp(source, {
      orgId,
      ownerId: actor.userId,
      origin: 'template',
      sourceTemplateId: template.id,
      title: request.title,
      varSchema: template.templateVars,
      provided: request.values,
    });
    if (!isCompensableSolutionClone(source, orgId, clone)) {
      throw new SolutionTemplateDeploymentError(
        'The template clone boundary returned an unsafe App identity',
        'cleanup-failed',
      );
    }
    createdAppId = clone.id;

    const connectors = await listConnectors(orgId);
    const connectorId = actionConnectorFor(clone, request.actionConnectorId, connectors);
    if (clone.steps.some((step) => step.kind === 'action') && !connectorId) {
      throw new SolutionTemplateDeploymentError(
        'Choose one available on-prem CRM connection for this solution',
        'action-connector-required',
      );
    }
    const candidate = {
      ...(connectorId ? bindSolutionActionConnector(clone, connectorId) : clone),
      pipelineId: request.pipelineId,
    };
    const domains = await listDomains(orgId);
    const selection = await validateEnterpriseAppSelections(
      { orgId, actor },
      capabilitySelectionProjection(candidate, domains),
    );
    if (!selection.ok) {
      throw new SolutionTemplateDeploymentError(
        'One or more solution requirements are not available to your account',
        'capability-denied',
        selection.errors,
      );
    }

    const bound = await updateApp(clone.id, orgId, {
      pipelineId: request.pipelineId,
      steps: candidate.steps,
    });
    if (!bound) {
      throw new SolutionTemplateDeploymentError(
        'The new App could not be bound to its governed requirements',
        'not-found',
      );
    }
    const published = await publishApp(bound.id, orgId);
    if (!published) {
      throw new SolutionTemplateDeploymentError(
        'The new App could not be published',
        'not-found',
      );
    }
    const deployment = await createSolutionDeployment(orgId, {
      blueprintId: blueprint.id,
      blueprintVersion: request.blueprintVersion,
      appId: published.id,
      status: 'active',
    });
    deploymentCreated = true;
    return {
      deploymentId: deployment.id,
      appId: published.id,
      blueprintId: blueprint.id,
      blueprintVersion: deployment.blueprintVersion,
      templateId: template.id,
      pipelineId: deployment.pipelineId,
      status: deployment.status,
      appHref: `/solutions/apps/${encodeURIComponent(published.id)}`,
      appTitle: published.title,
      requirements: solutionAppRequirements(published),
    };
  } catch (error) {
    if (createdAppId && !deploymentCreated) {
      try {
        await deleteApp(createdAppId, orgId);
      } catch {
        throw new SolutionTemplateDeploymentError(
          'Deployment failed and the private draft could not be removed',
          'cleanup-failed',
        );
      }
    }
    throw error;
  }
}

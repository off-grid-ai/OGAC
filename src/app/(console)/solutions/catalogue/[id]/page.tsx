import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { PageFrame } from '@/components/PageFrame';
import {
  SolutionDeploymentPanel,
  SolutionRequirementList,
  type SolutionRequirementView,
} from '@/components/solutions/SolutionDeploymentPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getActionDescriptor } from '@/lib/action-contract';
import { isCompatibleCrmActionConnector } from '@/lib/action-connector-compatibility';
import { getTemplateSourceSpec, listTemplates } from '@/lib/apps-store';
import { listDomains } from '@/lib/data-domains-store';
import { getEnterpriseContext } from '@/lib/enterprise-context';
import { requireModuleForUser } from '@/lib/module-access';
import { formatOutcomeCurrency, summarizeOutcome } from '@/lib/outcome-contract';
import { listPipelines } from '@/lib/pipelines';
import {
  registeredTemplateMatches,
  solutionAppRequirements,
} from '@/lib/solution-template-deployment';
import { evaluateSolutionCompatibility } from '@/lib/solution-blueprints';
import { getSolutionBlueprint } from '@/lib/solution-blueprints-store';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deploy?: string }>;
};

const CAPABILITY_COPY = {
  'grounded-inference': {
    label: 'Grounded enterprise AI',
    detail: 'The App can use approved organization data through its governed AI pipeline.',
    status: 'ready',
  },
  'human-approval': {
    label: 'Human approval',
    detail: 'A person reviews the recommendation before any governed action can run.',
    status: 'approval-required',
  },
  'report-output': {
    label: 'Governed report output',
    detail: 'The workflow produces a retained report from the completed run.',
    status: 'ready',
  },
} as const;

function canonical(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export default async function SolutionCatalogueDetailPage({ params, searchParams }: Props) {
  await requireModuleForUser('studio');
  const [{ id }, { deploy }, orgId, session] = await Promise.all([
    params,
    searchParams,
    currentOrgId(),
    auth(),
  ]);
  const blueprint = await getSolutionBlueprint(id, orgId);
  if (!blueprint) notFound();

  const actor = {
    userId: session?.user?.email ?? 'unknown-user',
    role: session?.user?.role,
  };
  const [templates, pipelines, domains, connectors, context] = await Promise.all([
    listTemplates(orgId),
    listPipelines(orgId),
    listDomains(orgId),
    listConnectors(orgId),
    getEnterpriseContext({ orgId, actor }),
  ]);

  const registeredTemplate = templates.find((template) =>
    registeredTemplateMatches(blueprint.sourceTemplateKey, template),
  );
  const source = registeredTemplate
    ? await getTemplateSourceSpec(registeredTemplate.id, orgId)
    : null;
  const sourceRequirements = source
    ? solutionAppRequirements(source)
    : { dataDomains: [], actions: [] };
  const domainTokens = domains.flatMap((domain) => [domain.id, domain.label, ...domain.aliases]);
  const compatiblePipelines = source
    ? pipelines.filter((pipeline) => {
        const permission = context.resources.find(
          (resource) => resource.ref === `pipeline:${pipeline.id}`,
        );
        return (
          permission?.canSelect === true &&
          evaluateSolutionCompatibility(
            blueprint,
            { ...source, pipelineId: pipeline.id },
            pipeline,
            domainTokens,
          ).compatible
        );
      })
    : [];
  const compatibleConnectors = connectors.filter(isCompatibleCrmActionConnector);
  const buildPermission = context.intentDecisions.find((item) => item.intent === 'build.create');

  const requirements: SolutionRequirementView[] = [
    {
      id: 'registered-workflow',
      label: 'Registered workflow',
      detail:
        registeredTemplate && source && blueprint.adoptable
          ? `${registeredTemplate.title} is the exact published workflow registered for this Blueprint version.`
          : !blueprint.adoptable
            ? 'This Blueprint does not yet have a verified runtime asset.'
            : 'The registered workflow is not visible to your organization.',
      status: registeredTemplate && source && blueprint.adoptable ? 'ready' : 'unavailable',
      ...(!registeredTemplate || !source || !blueprint.adoptable
        ? { remedyHref: '/solutions/templates' }
        : {}),
    },
    ...blueprint.requiredDataDomains.map((required): SolutionRequirementView => {
      const token = canonical(required);
      const domain = domains.find((candidate) =>
        [candidate.id, candidate.label, ...candidate.aliases].some(
          (value) => canonical(value) === token,
        ),
      );
      const resolved = domain
        ? context.resources.find((resource) => resource.ref === `data:${domain.id}`)
        : undefined;
      return {
        id: `data-${required}`,
        label: required,
        detail: resolved?.reason ?? 'This organization data domain has not been declared.',
        status: resolved?.canSelect ? 'ready' : 'unavailable',
        ...(!resolved?.canSelect ? { remedyHref: resolved?.remedyHref ?? '/data/domains' } : {}),
      };
    }),
    {
      id: 'governed-pipeline',
      label: blueprint.requiredPipelineName,
      detail: compatiblePipelines.length
        ? `${compatiblePipelines.length} published pipeline${compatiblePipelines.length === 1 ? '' : 's'} satisfy the data ceiling, workflow, and your access policy.`
        : 'No published pipeline currently satisfies this solution and your access policy.',
      status: compatiblePipelines.length ? 'ready' : 'unavailable',
      ...(compatiblePipelines.length ? {} : { remedyHref: '/runtime/pipelines' }),
    },
    ...blueprint.requiredCapabilities.map((capability): SolutionRequirementView => ({
      id: `capability-${capability}`,
      ...CAPABILITY_COPY[capability],
    })),
    ...sourceRequirements.actions.map((action): SolutionRequirementView => {
      const resolved = context.resources.find(
        (resource) => resource.ref === `action:${action.actionId}`,
      );
      const descriptor = getActionDescriptor(action.actionId);
      return {
        id: `action-${action.stepId}`,
        label: descriptor.label,
        detail: resolved?.reason ?? 'Your action permission could not be verified.',
        status: resolved?.canSelect
          ? resolved.requiresApproval
            ? 'approval-required'
            : 'ready'
          : 'unavailable',
        ...(!resolved?.canSelect
          ? { remedyHref: resolved?.remedyHref ?? '/governance/access' }
          : {}),
      };
    }),
    ...(sourceRequirements.actions.length
      ? [
          {
            id: 'action-connection',
            label: 'Enterprise action connection',
            detail: compatibleConnectors.length
              ? `${compatibleConnectors.length} verified on-prem CRM connection${compatibleConnectors.length === 1 ? '' : 's'} can perform this solution's governed actions.`
              : 'Add a verified on-prem CRM connection before this solution can write back.',
            status: compatibleConnectors.length ? ('ready' as const) : ('unavailable' as const),
            ...(compatibleConnectors.length ? {} : { remedyHref: '/data/sources' }),
          },
        ]
      : []),
    {
      id: 'deployment-permission',
      label: 'Your App permission',
      detail: buildPermission?.reason ?? 'Your permission to create Apps could not be verified.',
      status: buildPermission?.status === 'allowed' ? 'ready' : 'unavailable',
      ...(buildPermission?.status === 'allowed' ? {} : { remedyHref: '/governance/access' }),
    },
  ];

  const outcome = summarizeOutcome(blueprint.outcome);

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <Link
          href="/solutions/catalogue"
          className="inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Solution catalogue
        </Link>

        <header className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.55fr)] lg:items-end">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary">
              {blueprint.industry} / {blueprint.process} / v{blueprint.currentVersion}
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{blueprint.title}</h1>
            <p className="mt-2 max-w-4xl text-sm text-muted-foreground">{blueprint.summary}</p>
          </div>
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">What success means</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-muted-foreground">Target</p>
                <p className="mt-1 font-medium">
                  {blueprint.outcome.target.value.toLocaleString()} {blueprint.outcome.metricUnit}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">First-year net value</p>
                <p className="mt-1 font-medium">
                  {formatOutcomeCurrency(outcome.firstYearNetValue, blueprint.outcome.roi.currency)}
                </p>
              </div>
            </CardContent>
          </Card>
        </header>

        <section aria-labelledby="requirements-heading" className="space-y-4">
          <div>
            <h2 id="requirements-heading" className="text-base font-medium">
              What this solution needs
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Every item below comes from your live organization context. Nothing unavailable is
              hidden or silently replaced.
            </p>
          </div>
          <SolutionRequirementList requirements={requirements} />
        </section>

        <SolutionDeploymentPanel
          blueprintId={blueprint.id}
          blueprintVersion={blueprint.currentVersion}
          solutionTitle={blueprint.title}
          detailHref={`/solutions/catalogue/${encodeURIComponent(blueprint.id)}`}
          deploying={deploy === '1'}
          requirements={requirements}
          templates={
            registeredTemplate
              ? [
                  {
                    id: registeredTemplate.id,
                    title: registeredTemplate.title,
                    vars: registeredTemplate.templateVars.vars,
                  },
                ]
              : []
          }
          pipelines={compatiblePipelines.map((pipeline) => ({
            id: pipeline.id,
            label: pipeline.name,
          }))}
          connectors={compatibleConnectors.map((connector) => ({
            id: connector.id,
            label: connector.name,
          }))}
          hasActions={sourceRequirements.actions.length > 0}
        />
      </div>
    </PageFrame>
  );
}

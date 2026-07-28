import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { PageFrame } from '@/components/PageFrame';
import { SolutionsFlow } from '@/components/solutions/SolutionsFlow';
import { listAgentRuns } from '@/lib/agentrun';
import { buildDomainDashboard } from '@/lib/domain-dashboard';
import { listApps, listTemplates } from '@/lib/apps-store';
import {
  listSolutionBlueprints,
  listSolutionDeploymentCandidates,
  listSolutionDeployments,
} from '@/lib/solution-blueprints-store';
import { buildSolutionsFlow } from '@/lib/solutions-flow';
import { currentOrgId } from '@/lib/tenancy';
import { safeWithTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

// The Solutions hub. Previously a generic three-stat dashboard (Apps / Blueprints / Active
// deployments) whose numbers were correct and meaningless: nothing said what a blueprint was, how it
// related to an app, or why "Deployed" read zero. It now renders the real chain and, when a stage
// cannot proceed, the precondition it is waiting on — see src/lib/solutions-flow.ts for the rules.
//
// Compatibility is SERVER-derived (listSolutionDeploymentCandidates), never guessed from labels, so
// "you could bind this now" versus "no app satisfies a contract yet" is an honest distinction.
export default async function SolutionsRoot() {
  const orgId = await currentOrgId();
  const [apps, blueprints, deployments, candidates, templates] = await Promise.all([
    safeWithTimeout(() => listApps(orgId), 1500, null),
    safeWithTimeout(() => listSolutionBlueprints(orgId), 1500, null),
    safeWithTimeout(() => listSolutionDeployments(orgId), 1500, null),
    safeWithTimeout(() => listSolutionDeploymentCandidates(orgId), 2500, null),
    // The SAME read /solutions/templates uses, so the hub's count can never disagree with that page.
    safeWithTimeout(() => listTemplates(orgId), 1500, null),
  ]);

  const flow = buildSolutionsFlow({
    blueprints: (blueprints ?? []).map((b) => ({ id: b.id, adoptable: b.adoptable })),
    apps: (apps ?? []).map((a) => ({ id: a.id, published: Boolean(a.published) })),
    deployments: (deployments ?? []).map((d) => ({ id: d.id, status: d.status })),
    candidates: (candidates ?? []).map((c) => ({
      appId: c.appId,
      compatibleBlueprintIds: c.compatibleBlueprintIds,
    })),
    templateCount: (templates ?? []).length,
  });

  // The shared section-hub composition (consistent with the other seven sections), with the flow
  // rendered in its slot. The three counters alone are what made this page uninformative; the flow
  // supplies the relationship they cannot express.
  const runs = await safeWithTimeout(() => listAgentRuns(6, orgId), 1200, null);
  const publishedApps = (apps ?? []).filter((app) => app.published).length;
  const adoptableBlueprints = (blueprints ?? []).filter((item) => item.adoptable).length;
  const model = buildDomainDashboard('solutions', {
    // Deliberately NOT the three chain counts again: the chain below already shows Blueprints / Apps /
    // Deployed with their descriptions, and repeating them made one page say everything twice. These
    // are the readiness numbers the chain does not carry.
    facts: [
      {
        label: 'Published apps',
        value: `${publishedApps} of ${(apps ?? []).length}`,
        description: 'Only a published app can be run by someone other than its author.',
        href: '/solutions/apps',
        state: publishedApps === 0 && (apps ?? []).length > 0 ? ('attention' as const) : ('neutral' as const),
      },
      {
        label: 'Blueprints ready to deploy',
        value: `${adoptableBlueprints} of ${(blueprints ?? []).length}`,
        description:
          'Ready means a real app and governed pipeline already satisfy the contract, so it can be bound now.',
        href: '/solutions/library',
        state: adoptableBlueprints === 0 && (blueprints ?? []).length > 0 ? ('attention' as const) : ('neutral' as const),
      },
      {
        label: 'Reusable templates',
        value: String(flow.templateCount),
        description: 'Apps published for another team to clone as a starting point.',
        href: '/solutions/templates',
        state: 'neutral' as const,
      },
    ],
    activities: (runs ?? []).map((run) => ({
      id: run.id,
      label: run.agentId,
      detail: `${run.status}: ${run.query}`,
      timestamp: run.startedAt.slice(0, 10),
      href: `/solutions/agents/${run.agentId}/runs/${run.id}`,
    })),
  });

  return (
    <PageFrame>
      <DomainDashboard model={model}>
        <SolutionsFlow flow={flow} />
      </DomainDashboard>
    </PageFrame>
  );
}

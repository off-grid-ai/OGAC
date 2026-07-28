import { PageFrame } from '@/components/PageFrame';
import { SolutionsFlow } from '@/components/solutions/SolutionsFlow';
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

  return (
    <PageFrame>
      <SolutionsFlow flow={flow} />
    </PageFrame>
  );
}

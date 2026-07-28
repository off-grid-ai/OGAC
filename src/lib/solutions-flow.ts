// ─── The Solutions spine — PURE rules for "how do these things connect?" ────────────────────────────
//
// THE PROBLEM THIS SOLVES. The Solutions section shipped four sibling collections — Library, Deployed,
// Templates, Apps — with no surface stating how any of them relate. The sidebar listed them in that
// order, so the one thing that actually RUNS (an App) came fourth, behind three different flavours of
// "reusable thing". A route /solutions/catalogue duplicated Library's exact query under a synonymous
// name. An operator could not tell what to do first, or why "Deployed" was empty.
//
// THE MODEL, stated once, here, so every surface can say the same thing:
//
//   App         the workflow that actually runs. It owns build, input, runs, review and reports.
//               Everything else in this section points AT an app; nothing else executes.
//   Blueprint   a use-case CONTRACT: the outcome being promised, the data domains it requires, the
//               business owner, and versioned proof. It does not run. It becomes real when an App
//               implements it.
//   Deployment  the binding "this App implements this Blueprint at version N". This is what turns a
//               blueprint's CLAIMED outcome into measured evidence for your organisation.
//   Template    an App published so another team can clone it as a starting point. Pure reuse of a
//               build, with no outcome contract attached.
//
// So: Blueprint (the promise) + App (the implementation) → Deployment (adoption, measured).
// Templates are a shortcut for creating an App, not a step in that chain.
//
// Zero IO so the stage/readiness rules are unit-testable without a database.

export type SolutionStageId = 'blueprint' | 'app' | 'deployment';

/** A stage's readiness. `blocked` means the PRECONDITION is missing, not that something errored. */
export type SolutionStageState = 'empty' | 'blocked' | 'ready';

export interface SolutionsFlowInput {
  /** Blueprints in the org. `adoptable` = its runtime bindings are satisfied by some app+pipeline. */
  blueprints: readonly { id: string; adoptable: boolean }[];
  /** Apps in the org. */
  apps: readonly { id: string; published: boolean }[];
  /** Deployments in the org. */
  deployments: readonly { id: string; status: string }[];
  /**
   * Server-derived adoption choices: which blueprints each app is COMPATIBLE with. The UI must never
   * guess this from labels, so the caller passes what the store computed.
   */
  candidates: readonly { appId: string; compatibleBlueprintIds: readonly string[] }[];
  /** How many apps are published as reusable templates. */
  templateCount: number;
}

export interface SolutionStage {
  id: SolutionStageId;
  /** Short label — also the nav label, so the two cannot drift. */
  title: string;
  /** One sentence: what this thing IS. The answer to "why does this exist". */
  whatItIs: string;
  count: number;
  state: SolutionStageState;
  /** Present when state is `blocked`: the precondition, in the operator's terms. */
  blockedReason?: string;
  /** The single most useful next step from this stage. */
  action: { label: string; href: string };
}

export interface SolutionsFlow {
  stages: SolutionStage[];
  /** One line describing where this org actually stands. */
  headline: string;
  /** Apps published for reuse — adjacent to the chain, not a step in it. */
  templateCount: number;
}

/** Deployments that are live, as opposed to paused or retired. */
export function activeDeployments(
  deployments: readonly { status: string }[],
): readonly { status: string }[] {
  return deployments.filter((d) => d.status === 'active');
}

/** Every (app, blueprint) pair the server says is compatible — the deployments that COULD be made. */
export function bindablePairCount(input: SolutionsFlowInput): number {
  return input.candidates.reduce((n, c) => n + c.compatibleBlueprintIds.length, 0);
}

function blueprintStage(input: SolutionsFlowInput): SolutionStage {
  const count = input.blueprints.length;
  return {
    id: 'blueprint',
    title: 'Blueprints',
    whatItIs:
      'A use-case contract: the outcome promised, the data it needs, its owner, and versioned proof. A blueprint does not run.',
    count,
    state: count === 0 ? 'empty' : 'ready',
    action:
      count === 0
        ? { label: 'Create a blueprint', href: '/solutions/library' }
        : { label: 'Browse blueprints', href: '/solutions/library' },
  };
}

function appStage(input: SolutionsFlowInput): SolutionStage {
  const count = input.apps.length;
  const published = input.apps.filter((a) => a.published).length;
  return {
    id: 'app',
    title: 'Apps',
    whatItIs:
      'The workflow that actually runs. It owns build, input, runs, review and reports — nothing else here executes.',
    count,
    // An app with no published version can still be built and tested, so this is never "blocked".
    state: count === 0 ? 'empty' : 'ready',
    blockedReason:
      count > 0 && published === 0
        ? 'None are published yet, so no one else can run them.'
        : undefined,
    action:
      count === 0
        ? { label: 'Build your first app', href: '/solutions/apps/new' }
        : { label: 'Open apps', href: '/solutions/apps' },
  };
}

function deploymentStage(input: SolutionsFlowInput): SolutionStage {
  const active = activeDeployments(input.deployments).length;
  if (active > 0) {
    return {
      id: 'deployment',
      title: 'Deployed',
      whatItIs:
        'The binding that says this App implements this Blueprint — what turns a promised outcome into measured evidence.',
      count: active,
      state: 'ready',
      action: { label: 'Review deployments', href: '/solutions/deployed' },
    };
  }

  // Nothing deployed. Say WHY, in terms of the precondition that is actually missing, rather than
  // showing an empty list and leaving the operator to work it out.
  const bindable = bindablePairCount(input);
  const reason = (() => {
    if (input.blueprints.length === 0) return 'There are no blueprints to adopt yet.';
    if (input.apps.length === 0) return 'A blueprint needs an App to implement it before it can be deployed.';
    if (bindable === 0) {
      return 'No App currently satisfies a blueprint contract. Open a blueprint to see which data domains, actions or pipeline it still needs.';
    }
    return undefined;
  })();

  return {
    id: 'deployment',
    title: 'Deployed',
    whatItIs:
      'The binding that says this App implements this Blueprint — what turns a promised outcome into measured evidence.',
    count: 0,
    state: reason ? 'blocked' : 'ready',
    blockedReason: reason,
    action:
      bindable > 0
        ? { label: 'Bind a blueprint to an app', href: '/solutions/deployed' }
        : { label: 'See what is missing', href: '/solutions/library' },
  };
}

/** The headline: where this org stands in one sentence, never overstated. */
function headlineFor(stages: readonly SolutionStage[], input: SolutionsFlowInput): string {
  const active = activeDeployments(input.deployments).length;
  if (active > 0) {
    return `${active} ${active === 1 ? 'solution is' : 'solutions are'} deployed and measured against a blueprint contract.`;
  }
  const deployment = stages.find((s) => s.id === 'deployment');
  if (deployment?.blockedReason) return deployment.blockedReason;
  return 'Ready to bind a blueprint to an app and start measuring the outcome.';
}

/**
 * Build the three-stage flow for an org. The stages are always all three, in chain order, so the
 * relationship is visible even when a stage is empty — an empty stage that DISAPPEARS is exactly how
 * the section became unreadable.
 */
export function buildSolutionsFlow(input: SolutionsFlowInput): SolutionsFlow {
  const stages = [blueprintStage(input), appStage(input), deploymentStage(input)];
  return { stages, headline: headlineFor(stages, input), templateCount: input.templateCount };
}

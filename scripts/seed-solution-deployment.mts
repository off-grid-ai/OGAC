// ─── Adopt a blueprint against a real app, so "Deployed" is not a dead end ───────────────────────────
//
// WHY. solution_deployments was EMPTY in every org. The Solutions flow is Blueprint (the promised
// outcome) + App (what runs it) → Deployment (the binding that turns a promise into measured evidence),
// and the last stage had nothing in it. A read-only demo visitor reaching /solutions/deployed saw "No
// blueprints are deployed yet" — the end of the story missing, with no way for them to create one.
//
// WHAT. Binds each org's compatible (app, blueprint) pairs through the REAL createSolutionDeployment
// path, so it passes the same runtime-binding assertion the UI's "Bind a blueprint to an App" form
// does. Compatibility is SERVER-derived (listSolutionDeploymentCandidates) — never guessed from titles.
//
// HONEST BY CONSTRUCTION: if no app satisfies a blueprint's contract, nothing is created and the reason
// is printed. Forcing a deployment past the compatibility check would put a green "deployed" badge on a
// binding the platform cannot actually honour, which is exactly the governance theatre this codebase
// avoids elsewhere.
//
// IDEMPOTENT: an existing deployment for the same (blueprint, app) pair is left alone.
//
// RUN: npx tsx scripts/seed-solution-deployment.mts
import './worker-env.mts';
import {
  createSolutionDeployment,
  listSolutionBlueprints,
  listSolutionDeploymentCandidates,
  listSolutionDeployments,
} from '../src/lib/solution-blueprints-store.ts';

const ORGS = ['org_bharat', 'org_suraksha'] as const;
/** At most this many per org: the surface should look used, not spammed. */
const PER_ORG = 2;

for (const orgId of ORGS) {
  const [blueprints, candidates, existing] = await Promise.all([
    listSolutionBlueprints(orgId),
    listSolutionDeploymentCandidates(orgId),
    listSolutionDeployments(orgId),
  ]);
  const byId = new Map(blueprints.map((b) => [b.id, b]));
  const already = new Set(existing.map((d) => `${d.blueprintId}::${d.appId}`));

  const pairs = candidates.flatMap((candidate) =>
    candidate.compatibleBlueprintIds.map((blueprintId) => ({
      appId: candidate.appId,
      appTitle: candidate.appTitle,
      blueprintId,
    })),
  );

  if (pairs.length === 0) {
    // Report WHY rather than silently doing nothing: the incompatibility reasons are the useful signal.
    console.log(`${orgId}: no app satisfies any blueprint contract — nothing deployed.`);
    for (const candidate of candidates) {
      for (const [blueprintId, errors] of Object.entries(candidate.incompatibilities)) {
        const title = byId.get(blueprintId)?.title ?? blueprintId;
        console.log(`  - ${candidate.appTitle} cannot adopt "${title}": ${errors.join('; ')}`);
      }
    }
    continue;
  }

  let created = 0;
  for (const pair of pairs) {
    if (created >= PER_ORG) break;
    if (already.has(`${pair.blueprintId}::${pair.appId}`)) continue;
    const blueprint = byId.get(pair.blueprintId);
    if (!blueprint) continue;
    try {
      // Argument order is (orgId, input) — passing them the other way round made validateDeployment
      // receive the org string as its input and crash on `.trim()` of an undefined blueprintId.
      const deployment = await createSolutionDeployment(orgId, {
        blueprintId: pair.blueprintId,
        appId: pair.appId,
        blueprintVersion: blueprint.currentVersion,
        status: 'active',
        notes: `${blueprint.title} delivered by ${pair.appTitle}.`,
      } as never);
      created += 1;
      console.log(
        `${orgId}: deployed "${blueprint.title}" v${blueprint.currentVersion} on ${pair.appTitle} [${(deployment as { id?: string })?.id ?? 'created'}]`,
      );
    } catch (error) {
      // A refused binding is information, not a failure to paper over.
      console.log(
        `${orgId}: refused "${blueprint.title}" on ${pair.appTitle} — ${(error as Error).message}`,
      );
    }
  }
  if (created === 0) {
    // Distinguish "nothing left to do" from "everything was refused" — reporting a failure as an
    // already-satisfied state is exactly how a broken seed looks successful.
    const pending = pairs.filter((p) => !already.has(`${p.blueprintId}::${p.appId}`)).length;
    console.log(
      pending === 0
        ? `${orgId}: nothing new to deploy — all compatible pairs are already adopted.`
        : `${orgId}: ${pending} compatible pair(s) were REFUSED above; none deployed.`,
    );
  }
}

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, isNull, lt, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  apps,
  appRuns,
  solutionBlueprintSeedState,
  solutionBlueprints,
  solutionBlueprintVersions,
  solutionDeployments,
  solutionObservations,
  type SolutionBlueprintRow,
  type SolutionBlueprintVersionRow,
  type SolutionDeploymentRow,
  type SolutionObservationRow,
} from '@/db/schema';
import {
  SEEDED_SOLUTION_BLUEPRINTS,
  SOLUTION_BLUEPRINT_CATALOG_VERSION,
} from '@/lib/solution-blueprint-seeds';
import { computeReportMetrics } from '@/lib/app-reports';
import { toAppRunView } from '@/lib/app-runs-view';
import {
  evaluateSolutionCompatibility,
  hasAdoptableRuntimeBinding,
  normalizeCompatibilityApp,
  type SolutionBlueprint,
  type SolutionBlueprintInput,
  type SolutionBlueprintVersion,
  type SolutionDeployment,
  type SolutionDeploymentInput,
  type SolutionObservation,
  type SolutionObservationInput,
  validateBlueprint,
  validateDeployment,
  validateObservation,
  withEstimatedRoi,
} from '@/lib/solution-blueprints';
import { listDomains } from '@/lib/data-domains-store';
import { getPipeline } from '@/lib/pipelines';
import { hash12 } from '@/lib/tour-demo-seed';

export class SolutionValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join('; '));
    this.name = 'SolutionValidationError';
    this.errors = errors;
  }
}

export class SolutionConflictError extends Error {
  readonly code:
    'incompatible' | 'duplicate' | 'referenced' | 'retired' | 'paused' | 'runtime-drift';
  readonly errors: string[];

  constructor(
    message: string,
    code: 'incompatible' | 'duplicate' | 'referenced' | 'retired' | 'paused' | 'runtime-drift',
    errors: string[] = [],
  ) {
    super(message);
    this.name = 'SolutionConflictError';
    this.code = code;
    this.errors = errors;
  }
}

type BlueprintSnapshot = SolutionBlueprintInput;

function snapshot(row: SolutionBlueprintVersionRow): BlueprintSnapshot {
  return row.snapshot as unknown as BlueprintSnapshot;
}

function toVersion(row: SolutionBlueprintVersionRow): SolutionBlueprintVersion {
  return {
    ...snapshot(row),
    blueprintId: row.blueprintId,
    orgId: row.orgId,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toBlueprint(
  catalog: SolutionBlueprintRow,
  version: SolutionBlueprintVersionRow,
): SolutionBlueprint {
  const definition = toVersion(version);
  return {
    ...definition,
    id: catalog.id,
    currentVersion: catalog.currentVersion,
    sourceCatalogKey: catalog.sourceCatalogKey,
    catalogVersion: catalog.catalogVersion,
    tombstonedAt: catalog.tombstonedAt,
    createdAt: catalog.createdAt,
    updatedAt: catalog.updatedAt,
  };
}

/** Resolve catalog readiness from this tenant's real graph; persisted seed/editor flags are ignored. */
async function withRuntimeAdoptability(
  orgId: string,
  blueprints: SolutionBlueprint[],
): Promise<SolutionBlueprint[]> {
  if (!blueprints.length) return [];
  const [appRows, domains] = await Promise.all([
    db.select().from(apps).where(eq(apps.orgId, orgId)).orderBy(asc(apps.title)),
    listDomains(orgId),
  ]);
  const candidates = await Promise.all(
    appRows.map(async (app) => {
      const normalized = normalizeCompatibilityApp(app);
      return {
        app: normalized,
        pipeline: normalized.pipelineId ? await getPipeline(normalized.pipelineId, orgId) : null,
      };
    }),
  );
  const domainLabels = domains.map((domain) => domain.label);
  return blueprints.map((blueprint) => ({
    ...blueprint,
    adoptable: hasAdoptableRuntimeBinding(blueprint, candidates, domainLabels),
  }));
}

function toDeployment(row: SolutionDeploymentRow): SolutionDeployment {
  if (row.status !== 'active' && row.status !== 'paused' && row.status !== 'retired') {
    throw new Error(`invalid persisted solution deployment status: ${row.status}`);
  }
  return { ...row, status: row.status };
}

function toObservation(row: SolutionObservationRow): SolutionObservation {
  return withEstimatedRoi({
    ...row,
    evidenceLinks: row.evidenceLinks ?? [],
  });
}

function databaseErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === 'string') return record.code;
    current = record.cause;
  }
  return null;
}

async function seedBlueprints(orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [state] = await tx
      .select()
      .from(solutionBlueprintSeedState)
      .where(eq(solutionBlueprintSeedState.orgId, orgId))
      .limit(1);
    if ((state?.catalogVersion ?? 0) >= SOLUTION_BLUEPRINT_CATALOG_VERSION) return;

    for (const seed of SEEDED_SOLUTION_BLUEPRINTS) {
      const seedIdentity = `${orgId}:${seed.key}`;
      const id = `sbp_${hash12(seedIdentity)}`;
      await tx
        .insert(solutionBlueprints)
        .values({
          id,
          orgId,
          currentVersion: 1,
          sourceCatalogKey: seed.key,
          catalogVersion: null,
        })
        .onConflictDoNothing();
      const [catalog] = await tx
        .select()
        .from(solutionBlueprints)
        .where(and(eq(solutionBlueprints.id, id), eq(solutionBlueprints.orgId, orgId)))
        .limit(1);
      if (!catalog || catalog.tombstonedAt) continue;

      const next = catalog.catalogVersion ? catalog.currentVersion + 1 : 1;
      if ((catalog.catalogVersion ?? 0) < SOLUTION_BLUEPRINT_CATALOG_VERSION) {
        await tx.insert(solutionBlueprintVersions).values({
          id: `sbv_${randomUUID().slice(0, 12)}`,
          blueprintId: id,
          orgId,
          version: next,
          snapshot: seed.input as unknown as Record<string, unknown>,
          createdBy: 'system:solution-catalog',
        });
        await tx
          .update(solutionBlueprints)
          .set({
            currentVersion: next,
            catalogVersion: SOLUTION_BLUEPRINT_CATALOG_VERSION,
            updatedAt: new Date(),
          })
          .where(and(eq(solutionBlueprints.id, id), eq(solutionBlueprints.orgId, orgId)));
      }
    }
    await tx
      .insert(solutionBlueprintSeedState)
      .values({ orgId, catalogVersion: SOLUTION_BLUEPRINT_CATALOG_VERSION, seededAt: new Date() })
      .onConflictDoUpdate({
        target: solutionBlueprintSeedState.orgId,
        set: { catalogVersion: SOLUTION_BLUEPRINT_CATALOG_VERSION, seededAt: new Date() },
      });
  });
}

async function catalogWithVersion(
  id: string,
  orgId: string,
  version?: number,
): Promise<{ catalog: SolutionBlueprintRow; version: SolutionBlueprintVersionRow } | null> {
  const [catalog] = await db
    .select()
    .from(solutionBlueprints)
    .where(and(eq(solutionBlueprints.id, id), eq(solutionBlueprints.orgId, orgId)))
    .limit(1);
  if (!catalog) return null;
  const [definition] = await db
    .select()
    .from(solutionBlueprintVersions)
    .where(
      and(
        eq(solutionBlueprintVersions.blueprintId, id),
        eq(solutionBlueprintVersions.orgId, orgId),
        eq(solutionBlueprintVersions.version, version ?? catalog.currentVersion),
      ),
    )
    .limit(1);
  return definition ? { catalog, version: definition } : null;
}

/** Read the tenant catalog exactly as persisted; release verification must never seed on read. */
export async function listPersistedSolutionBlueprints(
  orgId: string,
  includeRetired = false,
): Promise<SolutionBlueprint[]> {
  const catalogs = await db
    .select()
    .from(solutionBlueprints)
    .where(
      includeRetired
        ? eq(solutionBlueprints.orgId, orgId)
        : and(eq(solutionBlueprints.orgId, orgId), isNull(solutionBlueprints.tombstonedAt)),
    )
    .orderBy(asc(solutionBlueprints.createdAt));
  const results = await Promise.all(
    catalogs.map((catalog) => catalogWithVersion(catalog.id, orgId)),
  );
  const blueprints = results
    .filter((value) => value !== null)
    .map(({ catalog, version }) => toBlueprint(catalog, version));
  return withRuntimeAdoptability(orgId, blueprints);
}

export async function listSolutionBlueprints(
  orgId: string,
  includeRetired = false,
): Promise<SolutionBlueprint[]> {
  await seedBlueprints(orgId);
  return listPersistedSolutionBlueprints(orgId, includeRetired);
}

export async function getSolutionBlueprint(
  id: string,
  orgId: string,
  version?: number,
): Promise<SolutionBlueprint | null> {
  await seedBlueprints(orgId);
  const result = await catalogWithVersion(id, orgId, version);
  if (!result) return null;
  return (await withRuntimeAdoptability(orgId, [toBlueprint(result.catalog, result.version)]))[0];
}

export async function listSolutionBlueprintVersions(
  id: string,
  orgId: string,
): Promise<SolutionBlueprintVersion[]> {
  return (
    await db
      .select()
      .from(solutionBlueprintVersions)
      .where(
        and(
          eq(solutionBlueprintVersions.blueprintId, id),
          eq(solutionBlueprintVersions.orgId, orgId),
        ),
      )
      .orderBy(desc(solutionBlueprintVersions.version))
  ).map(toVersion);
}

export async function createSolutionBlueprint(
  orgId: string,
  input: SolutionBlueprintInput,
  createdBy: string,
): Promise<SolutionBlueprint> {
  const errors = validateBlueprint(input);
  if (errors.length) throw new SolutionValidationError(errors);
  const id = `sbp_${randomUUID().slice(0, 12)}`;
  await db.transaction(async (tx) => {
    await tx.insert(solutionBlueprints).values({ id, orgId, currentVersion: 1 });
    await tx.insert(solutionBlueprintVersions).values({
      id: `sbv_${randomUUID().slice(0, 12)}`,
      blueprintId: id,
      orgId,
      version: 1,
      snapshot: input as unknown as Record<string, unknown>,
      createdBy,
    });
  });
  return (await getSolutionBlueprint(id, orgId))!;
}

export async function updateSolutionBlueprint(
  id: string,
  orgId: string,
  patch: Partial<SolutionBlueprintInput>,
  createdBy: string,
): Promise<SolutionBlueprint | null> {
  const current = await getSolutionBlueprint(id, orgId);
  if (!current) return null;
  if (current.tombstonedAt) throw new SolutionConflictError('blueprint is retired', 'retired');
  const merged: SolutionBlueprintInput = {
    title: current.title,
    summary: current.summary,
    industry: current.industry,
    process: current.process,
    businessOwner: current.businessOwner,
    requiredDataDomains: current.requiredDataDomains,
    requiredCapabilities: current.requiredCapabilities,
    requiredPipelineName: current.requiredPipelineName,
    sourceTemplateKey: current.sourceTemplateKey,
    adoptable: current.adoptable,
    outcome: current.outcome,
    proof: current.proof,
    ...patch,
  };
  const errors = validateBlueprint(merged);
  if (errors.length) throw new SolutionValidationError(errors);
  const next = current.currentVersion + 1;
  await db.transaction(async (tx) => {
    const advanced = await tx
      .update(solutionBlueprints)
      .set({ currentVersion: next, updatedAt: new Date() })
      .where(
        and(
          eq(solutionBlueprints.id, id),
          eq(solutionBlueprints.orgId, orgId),
          eq(solutionBlueprints.currentVersion, current.currentVersion),
          isNull(solutionBlueprints.tombstonedAt),
        ),
      )
      .returning({ id: solutionBlueprints.id });
    if (!advanced.length)
      throw new SolutionConflictError('blueprint changed; reload and retry', 'duplicate');
    await tx.insert(solutionBlueprintVersions).values({
      id: `sbv_${randomUUID().slice(0, 12)}`,
      blueprintId: id,
      orgId,
      version: next,
      snapshot: merged as unknown as Record<string, unknown>,
      createdBy,
    });
  });
  return getSolutionBlueprint(id, orgId);
}

/** Retire the catalog entry; immutable versions and deployment evidence remain readable forever. */
export async function deleteSolutionBlueprint(id: string, orgId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [catalog] = await tx
      .select({ id: solutionBlueprints.id, tombstonedAt: solutionBlueprints.tombstonedAt })
      .from(solutionBlueprints)
      .where(and(eq(solutionBlueprints.id, id), eq(solutionBlueprints.orgId, orgId)))
      .for('update')
      .limit(1);
    if (!catalog || catalog.tombstonedAt) return false;
    const [live] = await tx
      .select({ id: solutionDeployments.id })
      .from(solutionDeployments)
      .where(
        and(
          eq(solutionDeployments.blueprintId, id),
          eq(solutionDeployments.orgId, orgId),
          ne(solutionDeployments.status, 'retired'),
        ),
      )
      .limit(1);
    if (live) {
      throw new SolutionConflictError(
        'Retire every active or paused deployment before retiring this Blueprint',
        'referenced',
        ['retire the linked deployment, then retry'],
      );
    }
    const retired = await tx
      .update(solutionBlueprints)
      .set({ tombstonedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(solutionBlueprints.id, id),
          eq(solutionBlueprints.orgId, orgId),
          isNull(solutionBlueprints.tombstonedAt),
        ),
      )
      .returning({ id: solutionBlueprints.id });
    return retired.length > 0;
  });
}

export async function listSolutionDeployments(orgId: string): Promise<SolutionDeployment[]> {
  return (
    await db
      .select()
      .from(solutionDeployments)
      .where(eq(solutionDeployments.orgId, orgId))
      .orderBy(desc(solutionDeployments.updatedAt))
  ).map(toDeployment);
}

export interface SolutionDeploymentCandidate {
  appId: string;
  appTitle: string;
  compatibleBlueprintIds: string[];
  incompatibilities: Record<string, string[]>;
}

/** Server-derived adoption choices; the UI never guesses compatibility from labels. */
export async function listSolutionDeploymentCandidates(
  orgId: string,
): Promise<SolutionDeploymentCandidate[]> {
  const [blueprints, appRows, domains] = await Promise.all([
    listSolutionBlueprints(orgId),
    db.select().from(apps).where(eq(apps.orgId, orgId)).orderBy(asc(apps.title)),
    listDomains(orgId),
  ]);
  const domainLabels = domains.map((domain) => domain.label);
  return Promise.all(
    appRows.map(async (app) => {
      const appSpec = normalizeCompatibilityApp(app);
      const pipeline = appSpec.pipelineId ? await getPipeline(appSpec.pipelineId, orgId) : null;
      const evaluated = blueprints.map((blueprint) => ({
        blueprint,
        result: evaluateSolutionCompatibility(blueprint, appSpec, pipeline, domainLabels),
      }));
      return {
        appId: app.id,
        appTitle: app.title,
        compatibleBlueprintIds: evaluated
          .filter(({ result }) => result.compatible)
          .map(({ blueprint }) => blueprint.id),
        incompatibilities: Object.fromEntries(
          evaluated
            .filter(({ result }) => !result.compatible)
            .map(({ blueprint, result }) => [blueprint.id, result.errors]),
        ),
      };
    }),
  );
}

export async function getSolutionDeployment(
  id: string,
  orgId: string,
): Promise<SolutionDeployment | null> {
  const [row] = await db
    .select()
    .from(solutionDeployments)
    .where(and(eq(solutionDeployments.id, id), eq(solutionDeployments.orgId, orgId)))
    .limit(1);
  return row ? toDeployment(row) : null;
}

async function compatibleBinding(orgId: string, input: SolutionDeploymentInput) {
  const [blueprint, app] = await Promise.all([
    getSolutionBlueprint(input.blueprintId, orgId, input.blueprintVersion),
    db
      .select()
      .from(apps)
      .where(and(eq(apps.id, input.appId), eq(apps.orgId, orgId)))
      .limit(1),
  ]);
  if (!blueprint) throw new SolutionValidationError(['unknown blueprint version']);
  if (!app[0]) throw new SolutionValidationError(['unknown app']);
  const appSpec = normalizeCompatibilityApp(app[0]);
  const pipeline = appSpec.pipelineId ? await getPipeline(appSpec.pipelineId, orgId) : null;
  const domains = await listDomains(orgId);
  const compatibility = evaluateSolutionCompatibility(
    blueprint,
    appSpec,
    pipeline,
    domains.map((domain) => domain.label),
  );
  if (!compatibility.compatible || !compatibility.pipelineId) {
    throw new SolutionConflictError(
      'App is not compatible with the selected blueprint version',
      'incompatible',
      compatibility.errors,
    );
  }
  return { blueprint, app: appSpec, pipelineId: compatibility.pipelineId };
}

export async function createSolutionDeployment(
  orgId: string,
  input: SolutionDeploymentInput,
): Promise<SolutionDeployment> {
  const errors = validateDeployment(input);
  if (input.status === 'retired') errors.push('a new deployment cannot start retired');
  if (errors.length) throw new SolutionValidationError(errors);
  const binding = await compatibleBinding(orgId, input);
  try {
    return await db.transaction(async (tx) => {
      // Serialize adoption with Blueprint retirement. Whichever operation locks the catalog first
      // commits its policy decision; the other then observes that committed state.
      const [catalog] = await tx
        .select({ tombstonedAt: solutionBlueprints.tombstonedAt })
        .from(solutionBlueprints)
        .where(
          and(eq(solutionBlueprints.id, input.blueprintId), eq(solutionBlueprints.orgId, orgId)),
        )
        .for('update')
        .limit(1);
      if (!catalog || catalog.tombstonedAt) {
        throw new SolutionConflictError('Blueprint is retired', 'retired');
      }
      const [row] = await tx
        .insert(solutionDeployments)
        .values({
          id: `sdp_${randomUUID().slice(0, 12)}`,
          orgId,
          ...input,
          pipelineId: binding.pipelineId,
        })
        .returning();
      return toDeployment(row);
    });
  } catch (error) {
    if (databaseErrorCode(error) === '23505') {
      throw new SolutionConflictError('App already has a solution deployment', 'duplicate');
    }
    throw error;
  }
}

export async function updateSolutionDeployment(
  id: string,
  orgId: string,
  patch: Partial<Pick<SolutionDeploymentInput, 'status'>>,
): Promise<SolutionDeployment | null> {
  const current = await getSolutionDeployment(id, orgId);
  if (!current) return null;
  if (patch.status === undefined) throw new SolutionValidationError(['status is required']);
  const merged = { ...current, status: patch.status };
  const errors = validateDeployment(merged);
  if (errors.length) throw new SolutionValidationError(errors);
  if (current.status === 'retired' && patch.status !== 'retired') {
    throw new SolutionConflictError('retired deployments cannot be reactivated', 'retired');
  }
  if (patch.status === 'active') {
    await compatibleBinding(orgId, merged);
  }
  const transitionedAt = new Date();
  let pausedAt = current.pausedAt;
  if (patch.status === 'paused') pausedAt ??= transitionedAt;
  if (patch.status === 'active') pausedAt = null;
  const [row] = await db
    .update(solutionDeployments)
    .set({
      status: patch.status,
      activatedAt:
        patch.status === 'active' && current.status === 'paused'
          ? transitionedAt
          : current.activatedAt,
      pausedAt,
      retiredAt: patch.status === 'retired' ? transitionedAt : null,
      updatedAt: transitionedAt,
    })
    .where(and(eq(solutionDeployments.id, id), eq(solutionDeployments.orgId, orgId)))
    .returning();
  return row ? toDeployment(row) : null;
}

/** Deployment history is retired, never hard-deleted. */
export async function deleteSolutionDeployment(id: string, orgId: string): Promise<boolean> {
  const current = await getSolutionDeployment(id, orgId);
  if (!current) return false;
  await updateSolutionDeployment(id, orgId, { status: 'retired' });
  return true;
}

export async function hasSolutionDeploymentsForApp(appId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: solutionDeployments.id })
    .from(solutionDeployments)
    .where(and(eq(solutionDeployments.appId, appId), eq(solutionDeployments.orgId, orgId)))
    .limit(1);
  return Boolean(row);
}

export async function assertSolutionRuntimeBinding(
  app: Pick<import('@/lib/app-model').AppSpec, 'id' | 'pipelineId' | 'published' | 'steps'>,
  orgId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(solutionDeployments)
    .where(
      and(
        eq(solutionDeployments.appId, app.id),
        eq(solutionDeployments.orgId, orgId),
        ne(solutionDeployments.status, 'retired'),
      ),
    )
    .limit(1);
  if (!row) return;
  if (row.status === 'paused') {
    throw new SolutionConflictError(
      'Solution deployment is paused; reactivate it before running the App',
      'paused',
      ['reactivate the deployment or retire the binding'],
    );
  }
  try {
    const blueprint = await getSolutionBlueprint(row.blueprintId, orgId, row.blueprintVersion);
    if (!blueprint) throw new SolutionValidationError(['unknown blueprint version']);
    const appSpec = normalizeCompatibilityApp(app);
    const pipeline = appSpec.pipelineId ? await getPipeline(appSpec.pipelineId, orgId) : null;
    const domains = await listDomains(orgId);
    const compatibility = evaluateSolutionCompatibility(
      blueprint,
      appSpec,
      pipeline,
      domains.map((domain) => domain.label),
    );
    if (!compatibility.compatible || compatibility.pipelineId !== row.pipelineId) {
      throw new SolutionConflictError(
        'App is not compatible with the pinned solution deployment',
        'incompatible',
        compatibility.pipelineId !== row.pipelineId
          ? [...compatibility.errors, 'pinned pipeline changed']
          : compatibility.errors,
      );
    }
  } catch (error) {
    if (error instanceof SolutionConflictError || error instanceof SolutionValidationError) {
      throw new SolutionConflictError(
        'Active solution deployment drifted from its governed runtime contract',
        'runtime-drift',
        error.errors,
      );
    }
    throw error;
  }
}

export async function listSolutionObservations(
  deploymentId: string,
  orgId: string,
): Promise<SolutionObservation[]> {
  return (
    await db
      .select()
      .from(solutionObservations)
      .where(
        and(
          eq(solutionObservations.deploymentId, deploymentId),
          eq(solutionObservations.orgId, orgId),
        ),
      )
      .orderBy(desc(solutionObservations.windowEnd))
  ).map(toObservation);
}

/** Run evidence is scoped to this binding's activation boundary; pre-adoption App history is out. */
export async function listSolutionDeploymentRuns(deploymentId: string, orgId: string) {
  const deployment = await getSolutionDeployment(deploymentId, orgId);
  if (!deployment) return [];
  return db
    .select()
    .from(appRuns)
    .where(
      and(
        eq(appRuns.orgId, orgId),
        eq(appRuns.appId, deployment.appId),
        gte(appRuns.startedAt, deployment.activatedAt),
        deployment.pausedAt ? lt(appRuns.startedAt, deployment.pausedAt) : undefined,
        deployment.retiredAt ? lt(appRuns.startedAt, deployment.retiredAt) : undefined,
      ),
    )
    .orderBy(desc(appRuns.startedAt));
}

export async function createSolutionObservation(
  deploymentId: string,
  orgId: string,
  input: SolutionObservationInput,
  createdBy: string,
): Promise<SolutionObservation> {
  const errors = validateObservation(input);
  if (errors.length) throw new SolutionValidationError(errors);
  return db.transaction(async (tx) => {
    // One observation decision at a time per deployment. This closes the overlap race and
    // serializes the evidence window against retirement of the same binding.
    const [deploymentRow] = await tx
      .select()
      .from(solutionDeployments)
      .where(and(eq(solutionDeployments.id, deploymentId), eq(solutionDeployments.orgId, orgId)))
      .for('update')
      .limit(1);
    if (!deploymentRow) throw new SolutionValidationError(['unknown deployment']);
    const deployment = toDeployment(deploymentRow);
    if (input.windowStart < deployment.activatedAt) {
      throw new SolutionValidationError([
        'measurement window cannot predate deployment activation',
      ]);
    }
    if (deployment.pausedAt && input.windowEnd > deployment.pausedAt) {
      throw new SolutionValidationError([
        'measurement window cannot end after deployment was paused',
      ]);
    }
    if (deployment.retiredAt && input.windowEnd > deployment.retiredAt) {
      throw new SolutionValidationError([
        'measurement window cannot end after deployment retirement',
      ]);
    }
    const overlap = await tx
      .select({ id: solutionObservations.id })
      .from(solutionObservations)
      .where(
        and(
          eq(solutionObservations.deploymentId, deploymentId),
          eq(solutionObservations.orgId, orgId),
          lt(solutionObservations.windowStart, input.windowEnd),
          gt(solutionObservations.windowEnd, input.windowStart),
        ),
      );
    if (overlap.length) {
      throw new SolutionConflictError('measurement window overlaps existing evidence', 'duplicate');
    }
    const runRows = await tx
      .select()
      .from(appRuns)
      .where(
        and(
          eq(appRuns.orgId, orgId),
          eq(appRuns.appId, deployment.appId),
          eq(appRuns.status, 'done'),
          gte(appRuns.startedAt, input.windowStart),
          gte(appRuns.finishedAt, input.windowStart),
          lt(appRuns.finishedAt, input.windowEnd),
        ),
      )
      .orderBy(asc(appRuns.finishedAt));
    const runFacts = computeReportMetrics(runRows.map(toAppRunView));
    const [row] = await tx
      .insert(solutionObservations)
      .values({
        id: `sob_${randomUUID().slice(0, 12)}`,
        orgId,
        deploymentId,
        ...input,
        runIds: runRows.map((run) => run.id),
        runsCompleted: runFacts.completed,
        actualAiCost: runFacts.totalCostUsd,
        createdBy,
      })
      .returning();
    return toObservation(row);
  });
}

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  apps,
  solutionBlueprints,
  solutionDeployments,
  type SolutionBlueprintRow,
  type SolutionDeploymentRow,
} from '@/db/schema';
import { SEEDED_SOLUTION_BLUEPRINTS } from '@/lib/solution-blueprint-seeds';
import {
  type BlueprintProof,
  type SolutionBlueprint,
  type SolutionBlueprintInput,
  type SolutionDeployment,
  type SolutionDeploymentInput,
  validateBlueprint,
  validateDeployment,
} from '@/lib/solution-blueprints';
import type { OutcomeContract } from '@/lib/outcome-contract';
import { hash12 } from '@/lib/tour-demo-seed';

export class SolutionValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join('; '));
    this.name = 'SolutionValidationError';
    this.errors = errors;
  }
}

let ensurePromise: Promise<void> | null = null;
export async function ensureSolutionBlueprintSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS solution_blueprints (
      id text PRIMARY KEY, org_id text NOT NULL DEFAULT 'default', title text NOT NULL,
      summary text NOT NULL, industry text NOT NULL, process text NOT NULL,
      business_owner text NOT NULL, required_data_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
      required_tools jsonb NOT NULL DEFAULT '[]'::jsonb, governed_pipeline text NOT NULL,
      source_template_key text NOT NULL, outcome jsonb NOT NULL, proof jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS solution_blueprints_org_idx ON solution_blueprints (org_id)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS solution_deployments (
      id text PRIMARY KEY, org_id text NOT NULL DEFAULT 'default', blueprint_id text NOT NULL,
      app_id text NOT NULL, status text NOT NULL DEFAULT 'active', evidence_links jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS solution_deployments_org_idx ON solution_deployments (org_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS solution_deployments_binding_idx ON solution_deployments (org_id, blueprint_id, app_id)`);
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

const toBlueprint = (row: SolutionBlueprintRow): SolutionBlueprint => ({
  ...row,
  requiredDataDomains: row.requiredDataDomains ?? [],
  requiredTools: row.requiredTools ?? [],
  outcome: row.outcome as unknown as OutcomeContract,
  proof: row.proof as unknown as BlueprintProof,
});

const toDeployment = (row: SolutionDeploymentRow): SolutionDeployment => ({
  ...row,
  status: row.status === 'paused' || row.status === 'retired' ? row.status : 'active',
  evidenceLinks: row.evidenceLinks ?? [],
});

async function seedBlueprints(orgId: string): Promise<void> {
  for (const seed of SEEDED_SOLUTION_BLUEPRINTS) {
    const now = new Date();
    await db.insert(solutionBlueprints).values({
      id: `sbp_${hash12(`${orgId}:${seed.key}`)}`,
      orgId,
      ...seed.input,
      outcome: seed.input.outcome as unknown as Record<string, unknown>,
      proof: seed.input.proof as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
  }
}

export async function listSolutionBlueprints(orgId: string): Promise<SolutionBlueprint[]> {
  await ensureSolutionBlueprintSchema();
  await seedBlueprints(orgId);
  return (await db.select().from(solutionBlueprints).where(eq(solutionBlueprints.orgId, orgId)).orderBy(asc(solutionBlueprints.industry), asc(solutionBlueprints.title))).map(toBlueprint);
}

export async function getSolutionBlueprint(id: string, orgId: string): Promise<SolutionBlueprint | null> {
  await ensureSolutionBlueprintSchema();
  await seedBlueprints(orgId);
  const [row] = await db.select().from(solutionBlueprints).where(and(eq(solutionBlueprints.id, id), eq(solutionBlueprints.orgId, orgId))).limit(1);
  return row ? toBlueprint(row) : null;
}

export async function createSolutionBlueprint(orgId: string, input: SolutionBlueprintInput): Promise<SolutionBlueprint> {
  await ensureSolutionBlueprintSchema();
  const errors = validateBlueprint(input);
  if (errors.length) throw new SolutionValidationError(errors);
  const [row] = await db.insert(solutionBlueprints).values({
    ...input,
    id: `sbp_${randomUUID().slice(0, 12)}`,
    orgId,
    outcome: input.outcome as unknown as Record<string, unknown>,
    proof: input.proof as unknown as Record<string, unknown>,
  }).returning();
  return toBlueprint(row);
}

export async function updateSolutionBlueprint(id: string, orgId: string, patch: Partial<SolutionBlueprintInput>): Promise<SolutionBlueprint | null> {
  const current = await getSolutionBlueprint(id, orgId);
  if (!current) return null;
  const merged: SolutionBlueprintInput = { ...current, ...patch };
  const errors = validateBlueprint(merged);
  if (errors.length) throw new SolutionValidationError(errors);
  const [row] = await db.update(solutionBlueprints).set({
    title: merged.title, summary: merged.summary, industry: merged.industry, process: merged.process,
    businessOwner: merged.businessOwner, requiredDataDomains: merged.requiredDataDomains,
    requiredTools: merged.requiredTools, governedPipeline: merged.governedPipeline,
    sourceTemplateKey: merged.sourceTemplateKey,
    outcome: merged.outcome as unknown as Record<string, unknown>,
    proof: merged.proof as unknown as Record<string, unknown>, updatedAt: new Date(),
  }).where(and(eq(solutionBlueprints.id, id), eq(solutionBlueprints.orgId, orgId))).returning();
  return row ? toBlueprint(row) : null;
}

export async function deleteSolutionBlueprint(id: string, orgId: string): Promise<boolean> {
  await ensureSolutionBlueprintSchema();
  return db.transaction(async (tx) => {
    await tx.delete(solutionDeployments).where(and(eq(solutionDeployments.blueprintId, id), eq(solutionDeployments.orgId, orgId)));
    const deleted = await tx.delete(solutionBlueprints).where(and(eq(solutionBlueprints.id, id), eq(solutionBlueprints.orgId, orgId))).returning({ id: solutionBlueprints.id });
    return deleted.length > 0;
  });
}

export async function listSolutionDeployments(orgId: string): Promise<SolutionDeployment[]> {
  await ensureSolutionBlueprintSchema();
  return (await db.select().from(solutionDeployments).where(eq(solutionDeployments.orgId, orgId)).orderBy(desc(solutionDeployments.updatedAt))).map(toDeployment);
}

export async function getSolutionDeployment(id: string, orgId: string): Promise<SolutionDeployment | null> {
  await ensureSolutionBlueprintSchema();
  const [row] = await db.select().from(solutionDeployments).where(and(eq(solutionDeployments.id, id), eq(solutionDeployments.orgId, orgId))).limit(1);
  return row ? toDeployment(row) : null;
}

export async function createSolutionDeployment(orgId: string, input: SolutionDeploymentInput): Promise<SolutionDeployment> {
  await ensureSolutionBlueprintSchema();
  const errors = validateDeployment(input);
  if (errors.length) throw new SolutionValidationError(errors);
  const [blueprint, app] = await Promise.all([
    getSolutionBlueprint(input.blueprintId, orgId),
    db.select({ id: apps.id }).from(apps).where(and(eq(apps.id, input.appId), eq(apps.orgId, orgId))).limit(1),
  ]);
  if (!blueprint) throw new SolutionValidationError(['unknown blueprint']);
  if (!app[0]) throw new SolutionValidationError(['unknown app']);
  const [row] = await db.insert(solutionDeployments).values({ id: `sdp_${randomUUID().slice(0, 12)}`, orgId, ...input }).returning();
  return toDeployment(row);
}

export async function updateSolutionDeployment(id: string, orgId: string, patch: Partial<Pick<SolutionDeploymentInput, 'status' | 'evidenceLinks'>>): Promise<SolutionDeployment | null> {
  const current = await getSolutionDeployment(id, orgId);
  if (!current) return null;
  const merged = { ...current, ...patch };
  const errors = validateDeployment(merged);
  if (errors.length) throw new SolutionValidationError(errors);
  const [row] = await db.update(solutionDeployments).set({ status: merged.status, evidenceLinks: merged.evidenceLinks, updatedAt: new Date() }).where(and(eq(solutionDeployments.id, id), eq(solutionDeployments.orgId, orgId))).returning();
  return row ? toDeployment(row) : null;
}

export async function deleteSolutionDeployment(id: string, orgId: string): Promise<boolean> {
  await ensureSolutionBlueprintSchema();
  const deleted = await db.delete(solutionDeployments).where(and(eq(solutionDeployments.id, id), eq(solutionDeployments.orgId, orgId))).returning({ id: solutionDeployments.id });
  return deleted.length > 0;
}

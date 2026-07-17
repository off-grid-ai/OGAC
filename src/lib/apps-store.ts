// ─── Apps store (Builder Epic #108, Phase 1A) — thin I/O over the `apps` table ──
// CRUD for the unified App entity. SOLID split: the pure model + validation live in app-model.ts;
// this file is the storage adapter only — it validates via validateAppSpec on every write, scopes
// every read/write to an org (like connectors/templates in store.ts), and returns typed AppSpec.
// It never re-implements a rule that belongs in app-model.ts.

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { apps, customAgents, type App } from '@/db/schema';
import { materializedAgentIds } from '@/lib/app-agent-ownership';
import {
  type AppSpec,
  type AppStep,
  type AppEdge,
  type TriggerSpec,
  type FormField,
  validateAppSpec,
} from '@/lib/app-model';
import { hideDemoTestArtifact } from '@/lib/demo-test-artifacts';

const DEFAULT_ORG = 'default';

// ─── self-migrate safety net (memoized; mirrors ensurePipelinesSchema/ensureChatSchema) ────────────
// Deploy is rsync-only (no migration step over SSH), so the store self-provisions the `apps` table +
// any post-hoc columns (CREATE/ALTER … IF NOT EXISTS). Column names MUST match schema.ts exactly.
let appsEnsure: Promise<void> | null = null;
export async function ensureAppsSchema(): Promise<void> {
  if (appsEnsure) return appsEnsure;
  appsEnsure = db
    .transaction(async (tx): Promise<void> => {
      // Multiple node:test workers and console processes can cold-start this self-migration together.
      // Serialize the DDL transaction so PostgreSQL's IF NOT EXISTS catalog race cannot surface.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('offgrid_apps_schema_v2'));`);
      await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS apps (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        owner_id text NOT NULL,
        title text NOT NULL,
        summary text NOT NULL DEFAULT '',
        visibility text NOT NULL DEFAULT 'private',
        pipeline_id text,
        slug text,
        published boolean NOT NULL DEFAULT false,
        trigger jsonb NOT NULL DEFAULT '{"kind":"on-demand"}'::jsonb,
        input_form jsonb,
        steps jsonb NOT NULL DEFAULT '[]'::jsonb,
        edges jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
      // Post-hoc column for the pipeline binding (CONSUMERS-BIND #166) on a pre-existing apps table.
      await tx.execute(sql`ALTER TABLE apps ADD COLUMN IF NOT EXISTS pipeline_id text;`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS apps_org_idx ON apps (org_id);`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS apps_slug_idx ON apps (slug);`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS apps_pipeline_idx ON apps (pipeline_id);`);
      // Runtime-agent ownership is database-enforced and tenant-safe. The composite target prevents
      // an owner id from pointing at an App in another org; CASCADE makes App deletion atomic.
      await tx.execute(sql`ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS owner_app_id text;`);
      await tx.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS apps_id_org_unique ON apps (id, org_id);`,
      );
      await tx.execute(
        sql`CREATE INDEX IF NOT EXISTS custom_agents_owner_app_idx ON custom_agents (owner_app_id);`,
      );
      await tx.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'custom_agents_owner_app_org_fk'
        ) THEN
          ALTER TABLE custom_agents
            ADD CONSTRAINT custom_agents_owner_app_org_fk
            FOREIGN KEY (owner_app_id, org_id)
            REFERENCES apps (id, org_id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    })
    .catch((e) => {
      appsEnsure = null;
      throw e;
    });
  return appsEnsure;
}

// The mutable part of an AppSpec — everything a caller supplies on create (ids/timestamps are
// minted by the store; slug/published are managed by publishApp).
export type AppSpecInput = Pick<
  AppSpec,
  'title' | 'summary' | 'visibility' | 'trigger' | 'inputForm' | 'steps' | 'edges'
> & { published?: boolean; slug?: string; pipelineId?: string | null };

// A patch on an existing app — any subset of the mutable fields.
export type AppPatch = Partial<AppSpecInput>;

// ─── Row ↔ AppSpec mapping ─────────────────────────────────────────────────────
function toAppSpec(row: App): AppSpec {
  return {
    id: row.id,
    orgId: row.orgId,
    ownerId: row.ownerId,
    title: row.title,
    summary: row.summary,
    visibility: normalizeVisibility(row.visibility),
    pipelineId: row.pipelineId ?? null,
    slug: row.slug ?? undefined,
    published: row.published,
    trigger: (row.trigger as TriggerSpec) ?? { kind: 'on-demand' },
    inputForm: (row.inputForm as FormField[] | null) ?? undefined,
    steps: (row.steps as unknown as AppStep[]) ?? [],
    edges: (row.edges as AppEdge[]) ?? [],
  };
}

function normalizeVisibility(v: string): 'private' | 'org' | 'public' {
  return v === 'org' || v === 'public' ? v : 'private';
}

// Build the full spec that validation runs against (store-managed fields filled in).
function specFor(id: string, orgId: string, ownerId: string, input: AppSpecInput): AppSpec {
  return {
    id,
    orgId,
    ownerId,
    title: input.title,
    summary: input.summary ?? '',
    visibility: normalizeVisibility(input.visibility ?? 'private'),
    pipelineId: input.pipelineId ?? null,
    slug: input.slug,
    published: input.published ?? false,
    trigger: input.trigger ?? { kind: 'on-demand' },
    inputForm: input.inputForm,
    steps: input.steps ?? [],
    edges: input.edges ?? [],
  };
}

class AppValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(`invalid app spec: ${errors.join('; ')}`);
    this.name = 'AppValidationError';
    this.errors = errors;
  }
}
export { AppValidationError };

export class AppAgentOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppAgentOwnershipError';
  }
}

// ─── createApp ─────────────────────────────────────────────────────────────────
export async function createApp(
  orgId: string,
  ownerId: string,
  input: AppSpecInput,
): Promise<AppSpec> {
  await ensureAppsSchema();
  const id = `app_${randomUUID().slice(0, 8)}`;
  const spec = specFor(id, orgId || DEFAULT_ORG, ownerId, input);
  const check = validateAppSpec(spec);
  if (!check.ok) throw new AppValidationError(check.errors);

  const [row] = await db
    .insert(apps)
    .values({
      id,
      orgId: spec.orgId,
      ownerId: spec.ownerId,
      title: spec.title,
      summary: spec.summary,
      visibility: spec.visibility,
      pipelineId: spec.pipelineId ?? null,
      slug: spec.slug ?? null,
      published: spec.published,
      trigger: spec.trigger,
      // FormField uses `key`; the jsonb column type declares `id`. Store the model shape verbatim
      // (jsonb is untyped at rest) and read it back as FormField[] in toAppSpec.
      inputForm: (spec.inputForm ?? null) as never,
      steps: spec.steps as never,
      edges: spec.edges,
    })
    .returning();
  return toAppSpec(row);
}

// ─── getApp — by id, org-scoped ─────────────────────────────────────────────────
export async function getApp(id: string, orgId: string): Promise<AppSpec | null> {
  await ensureAppsSchema();
  const [row] = await db
    .select()
    .from(apps)
    .where(and(eq(apps.id, id), eq(apps.orgId, orgId || DEFAULT_ORG)))
    .limit(1);
  return row ? toAppSpec(row) : null;
}

// ─── getAppBySlug — public lookup for /app/<slug> (slug is globally unique) ─────
// Not org-scoped: a published app is served by its slug regardless of the viewer's org.
export async function getAppBySlug(slug: string): Promise<AppSpec | null> {
  await ensureAppsSchema();
  const [row] = await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);
  return row ? toAppSpec(row) : null;
}

// ─── listApps — all apps in an org, newest first ────────────────────────────────
export async function listApps(orgId: string): Promise<AppSpec[]> {
  await ensureAppsSchema();
  const rows = await db
    .select()
    .from(apps)
    .where(eq(apps.orgId, orgId || DEFAULT_ORG))
    .orderBy(desc(apps.createdAt));
  // On customer-facing demo tenants, hide QA `[autotest]` apps (see demo-test-artifacts.ts).
  return rows
    .map(toAppSpec)
    .filter((a) => !hideDemoTestArtifact(orgId, { title: a.title, ownerId: a.ownerId }));
}

// ─── findAppByAgentId — canonical authored-agent ownership lookup ─────────────
// Runtime custom-agent rows are an execution detail of an AppSpec. This lookup lets legacy
// /build/agents/:id deep links resolve to the owning app lifecycle without exposing a second
// authoring surface. It is deliberately org-scoped and returns only the first owning AppSpec;
// materialized runtime agents are expected to have exactly one owner.
export async function findAppByAgentId(agentId: string, orgId: string): Promise<AppSpec | null> {
  await ensureAppsSchema();
  const rows = await db
    .select()
    .from(apps)
    .where(eq(apps.orgId, orgId || DEFAULT_ORG))
    .orderBy(desc(apps.createdAt));
  const all = rows.map(toAppSpec);
  return (
    all.find((app) =>
      app.steps.some((step) => step.kind === 'agent' && step.agentId === agentId),
    ) ?? null
  );
}

// ─── listAppsByPipeline — apps/agents BOUND to a pipeline (Overview "Consumers") ─
// Org-scoped, newest first. Read-only filter over the same rows as listApps — powers the pipeline
// Overview's live Consumers section (count + links). Never diverges from the canonical mapping.
export async function listAppsByPipeline(pipelineId: string, orgId: string): Promise<AppSpec[]> {
  await ensureAppsSchema();
  const rows = await db
    .select()
    .from(apps)
    .where(and(eq(apps.orgId, orgId || DEFAULT_ORG), eq(apps.pipelineId, pipelineId)))
    .orderBy(desc(apps.createdAt));
  return rows
    .map(toAppSpec)
    .filter((a) => !hideDemoTestArtifact(orgId, { title: a.title, ownerId: a.ownerId }));
}

// ─── updateApp — patch, org-scoped, re-validated ────────────────────────────────
export async function updateApp(
  id: string,
  orgId: string,
  patch: AppPatch,
): Promise<AppSpec | null> {
  await ensureAppsSchema();
  const scopedOrgId = orgId || DEFAULT_ORG;
  return db.transaction(async (tx) => {
    const [currentRow] = await tx
      .select()
      .from(apps)
      .where(and(eq(apps.id, id), eq(apps.orgId, scopedOrgId)))
      .for('update')
      .limit(1);
    if (!currentRow) return null;
    const current = toAppSpec(currentRow);

    const merged: AppSpec = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.visibility !== undefined
        ? { visibility: normalizeVisibility(patch.visibility) }
        : {}),
      ...(patch.pipelineId !== undefined ? { pipelineId: patch.pipelineId ?? null } : {}),
      ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      ...(patch.published !== undefined ? { published: patch.published } : {}),
      ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
      ...(patch.inputForm !== undefined ? { inputForm: patch.inputForm } : {}),
      ...(patch.steps !== undefined ? { steps: patch.steps } : {}),
      ...(patch.edges !== undefined ? { edges: patch.edges } : {}),
    };
    const check = validateAppSpec(merged);
    if (!check.ok) throw new AppValidationError(check.errors);

    const previousOwnedIds = new Set(materializedAgentIds(current));
    const nextOwnedIds = new Set(materializedAgentIds(merged));
    for (const agentId of nextOwnedIds) {
      const [agent] = await tx
        .select({ id: customAgents.id, ownerAppId: customAgents.ownerAppId })
        .from(customAgents)
        .where(and(eq(customAgents.id, agentId), eq(customAgents.orgId, scopedOrgId)))
        .for('update')
        .limit(1);
      if (!agent) {
        throw new AppAgentOwnershipError(
          `Runtime agent '${agentId}' is missing from org '${scopedOrgId}'.`,
        );
      }
      if (agent.ownerAppId && agent.ownerAppId !== id) {
        throw new AppAgentOwnershipError(
          `Runtime agent '${agentId}' is already owned by App '${agent.ownerAppId}'.`,
        );
      }
      await tx
        .update(customAgents)
        .set({ ownerAppId: id, pipelineId: merged.pipelineId ?? null })
        .where(and(eq(customAgents.id, agentId), eq(customAgents.orgId, scopedOrgId)));
    }
    const removedIds = [...previousOwnedIds].filter((agentId) => !nextOwnedIds.has(agentId));
    if (removedIds.length) {
      await tx
        .delete(customAgents)
        .where(
          and(
            eq(customAgents.orgId, scopedOrgId),
            eq(customAgents.ownerAppId, id),
            inArray(customAgents.id, removedIds),
          ),
        );
    }

    const [row] = await tx
      .update(apps)
      .set({
        title: merged.title,
        summary: merged.summary,
        visibility: merged.visibility,
        pipelineId: merged.pipelineId ?? null,
        slug: merged.slug ?? null,
        published: merged.published,
        trigger: merged.trigger,
        inputForm: (merged.inputForm ?? null) as never,
        steps: merged.steps as never,
        edges: merged.edges,
        updatedAt: new Date(),
      })
      .where(and(eq(apps.id, id), eq(apps.orgId, scopedOrgId)))
      .returning();
    return row ? toAppSpec(row) : null;
  });
}

/**
 * Materialize one inline App agent exactly once. The App row lock serializes concurrent first runs;
 * the runtime insert and step.agentId patch are committed as one ownership aggregate.
 */
export async function materializeAppAgent(
  appId: string,
  stepId: string,
  orgId: string,
): Promise<string> {
  await ensureAppsSchema();
  const scopedOrgId = orgId || DEFAULT_ORG;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(apps)
      .where(and(eq(apps.id, appId), eq(apps.orgId, scopedOrgId)))
      .for('update')
      .limit(1);
    if (!row) throw new AppAgentOwnershipError(`App '${appId}' was not found.`);
    const spec = toAppSpec(row);
    const step = spec.steps.find((candidate) => candidate.id === stepId);
    if (!step || step.kind !== 'agent' || !step.inlineAgent) {
      throw new AppAgentOwnershipError(
        `App '${appId}' step '${stepId}' is not an inline agent step.`,
      );
    }
    if (step.agentId) {
      const [owned] = await tx
        .select({ id: customAgents.id, ownerAppId: customAgents.ownerAppId })
        .from(customAgents)
        .where(and(eq(customAgents.id, step.agentId), eq(customAgents.orgId, scopedOrgId)))
        .for('update')
        .limit(1);
      if (!owned) {
        throw new AppAgentOwnershipError(`Runtime agent '${step.agentId}' is missing.`);
      }
      if (owned.ownerAppId && owned.ownerAppId !== appId) {
        throw new AppAgentOwnershipError(
          `Runtime agent '${step.agentId}' is already owned by App '${owned.ownerAppId}'.`,
        );
      }
      if (!owned.ownerAppId) {
        await tx
          .update(customAgents)
          .set({ ownerAppId: appId, pipelineId: spec.pipelineId ?? null })
          .where(and(eq(customAgents.id, step.agentId), eq(customAgents.orgId, scopedOrgId)));
      }
      return step.agentId;
    }

    const agentId = `agent_${randomUUID().slice(0, 8)}`;
    await tx.insert(customAgents).values({
      id: agentId,
      orgId: scopedOrgId,
      ownerAppId: appId,
      pipelineId: spec.pipelineId ?? null,
      name: `${spec.title || 'App'} · ${step.label || step.id}`,
      role: 'App step',
      description: `Inline agent materialized for app "${spec.title}" step "${step.id}".`,
      systemPrompt: step.inlineAgent.systemPrompt,
      model: step.inlineAgent.model ?? '',
      tools: step.inlineAgent.tools ?? [],
      grounded: step.inlineAgent.grounded ?? true,
      trigger: 'on-demand',
    });
    step.agentId = agentId;
    await tx
      .update(apps)
      .set({ steps: spec.steps as never, updatedAt: new Date() })
      .where(and(eq(apps.id, appId), eq(apps.orgId, scopedOrgId)));
    return agentId;
  });
}

// ─── deleteApp — org-scoped ──────────────────────────────────────────────────────
export async function deleteApp(id: string, orgId: string): Promise<void> {
  await ensureAppsSchema();
  const scopedOrgId = orgId || DEFAULT_ORG;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(apps)
      .where(and(eq(apps.id, id), eq(apps.orgId, scopedOrgId)))
      .for('update')
      .limit(1);
    if (!row) return;
    const legacyIds = materializedAgentIds(toAppSpec(row));
    if (legacyIds.length) {
      await tx
        .delete(customAgents)
        .where(
          and(
            eq(customAgents.orgId, scopedOrgId),
            inArray(customAgents.id, legacyIds),
            or(isNull(customAgents.ownerAppId), eq(customAgents.ownerAppId, id)),
          ),
        );
    }
    await tx.delete(apps).where(and(eq(apps.id, id), eq(apps.orgId, scopedOrgId)));
  });
}

// ─── publishApp — mint a slug + mark published, org-scoped ─────────────────────
// Idempotent-ish: if already published with a slug, returns as-is. Otherwise mints a slug from the
// title (+ short random suffix for global uniqueness) and flips published=true.
export async function publishApp(id: string, orgId: string): Promise<AppSpec | null> {
  const current = await getApp(id, orgId);
  if (!current) return null;
  if (current.published && current.slug) return current;

  const slug = current.slug ?? mintSlug(current.title);
  const [row] = await db
    .update(apps)
    .set({ published: true, slug, updatedAt: new Date() })
    .where(and(eq(apps.id, id), eq(apps.orgId, orgId || DEFAULT_ORG)))
    .returning();
  return row ? toAppSpec(row) : null;
}

// Slugify a title → lowercase, dash-separated, alnum only, with a short random suffix so two apps
// with the same title never collide on the globally-unique slug column.
function mintSlug(title: string): string {
  const base =
    (title || 'app')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'app';
  return `${base}-${randomUUID().slice(0, 6)}`;
}

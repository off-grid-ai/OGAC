// ─── Apps store (Builder Epic #108, Phase 1A) — thin I/O over the `apps` table ──
// CRUD for the unified App entity. SOLID split: the pure model + validation live in app-model.ts;
// this file is the storage adapter only — it validates via validateAppSpec on every write, scopes
// every read/write to an org (like connectors/templates in store.ts), and returns typed AppSpec.
// It never re-implements a rule that belongs in app-model.ts.

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
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
import {
  cloneAppSpec,
  type AppLineage,
  type CloneOrigin,
} from '@/lib/app-clone';
import {
  bindTemplateVars,
  validateVarSchema,
  type BindResult,
  type TemplateVarSchema,
} from '@/lib/app-template-vars';
import { hideDemoTestArtifact } from '@/lib/demo-test-artifacts';
import { ensurePipelinesSchema } from '@/lib/pipelines';
import { ensureOrgSchema } from '@/lib/store';

const DEFAULT_ORG = 'default';

// ─── self-migrate safety net (memoized; mirrors ensurePipelinesSchema/ensureChatSchema) ────────────
// Deploy is rsync-only (no migration step over SSH), so the store self-provisions the `apps` table +
// any post-hoc columns (CREATE/ALTER … IF NOT EXISTS). Column names MUST match schema.ts exactly.
let appsEnsure: Promise<void> | null = null;

async function runAppOwnershipBackfill(execute: (query: SQL) => Promise<unknown>): Promise<void> {
  // Refuse an ambiguous upgrade rather than assigning one runtime agent to a random App. This is
  // an actionable data-integrity failure; the normal legacy shape has one step reference per agent.
  await execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT step->>'agentId'
        FROM apps a
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.steps, '[]'::jsonb)) step
        WHERE step->>'kind' = 'agent'
          AND COALESCE(step->>'agentId', '') <> ''
          AND step->'inlineAgent' IS NOT NULL
          AND step->'inlineAgent' <> 'null'::jsonb
        GROUP BY a.org_id, step->>'agentId'
        HAVING COUNT(DISTINCT a.id) > 1
      ) THEN
        RAISE EXCEPTION 'runtime agent is referenced by multiple Apps in one org';
      END IF;
    END $$;
  `);
  // Upgrade old App rows that already materialized an agent before owner_app_id existed. Re-running
  // this statement is a no-op after the first repair and also re-aligns the inherited pipeline.
  await execute(sql`
    UPDATE custom_agents ca
    SET owner_app_id = a.id, pipeline_id = a.pipeline_id
    FROM apps a
    WHERE ca.org_id = a.org_id
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(a.steps, '[]'::jsonb)) step
        WHERE step->>'kind' = 'agent'
          AND step->>'agentId' = ca.id
          AND step->'inlineAgent' IS NOT NULL
          AND step->'inlineAgent' <> 'null'::jsonb
      )
      AND (ca.owner_app_id IS NULL OR ca.owner_app_id = a.id)
      AND (ca.owner_app_id, ca.pipeline_id) IS DISTINCT FROM (a.id, a.pipeline_id);
  `);
}

export async function ensureAppsSchema(): Promise<void> {
  if (appsEnsure) return appsEnsure;
  // Establish dependency tables/columns in one order before taking the Apps migration lock.
  await ensurePipelinesSchema();
  await ensureOrgSchema();
  appsEnsure = db
    .transaction(async (tx): Promise<void> => {
      // Multiple node:test workers and console processes can cold-start this self-migration together.
      // Serialize the DDL transaction so PostgreSQL's IF NOT EXISTS catalog race cannot surface.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('offgrid_schema_ddl'));`);
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
      // SOP / template reuse: template-publish + clone-lineage columns on a pre-existing apps table.
      await tx.execute(
        sql`ALTER TABLE apps ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;`,
      );
      await tx.execute(sql`ALTER TABLE apps ADD COLUMN IF NOT EXISTS template_vars jsonb;`);
      await tx.execute(sql`ALTER TABLE apps ADD COLUMN IF NOT EXISTS lineage jsonb;`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS apps_org_idx ON apps (org_id);`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS apps_slug_idx ON apps (slug);`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS apps_pipeline_idx ON apps (pipeline_id);`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS apps_template_idx ON apps (is_template);`);
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
      await runAppOwnershipBackfill((query) => tx.execute(query));

      // Legacy dangling bindings cannot be granted execution rights. Clear them before installing
      // the composite tenant-safe FKs; current dispatch already treats them as invalid/fail-closed.
      await tx.execute(sql`
        UPDATE apps a SET pipeline_id = NULL
        WHERE pipeline_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM pipelines p WHERE p.id = a.pipeline_id AND p.org_id = a.org_id
        );
      `);
      await tx.execute(sql`
        UPDATE custom_agents ca SET pipeline_id = NULL
        WHERE pipeline_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM pipelines p WHERE p.id = ca.pipeline_id AND p.org_id = ca.org_id
        );
      `);
      await tx.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_pipeline_org_fk') THEN
            ALTER TABLE apps ADD CONSTRAINT apps_pipeline_org_fk
              FOREIGN KEY (pipeline_id, org_id) REFERENCES pipelines (id, org_id)
              ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'custom_agents_pipeline_org_fk'
          ) THEN
            ALTER TABLE custom_agents ADD CONSTRAINT custom_agents_pipeline_org_fk
              FOREIGN KEY (pipeline_id, org_id) REFERENCES pipelines (id, org_id)
              ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
          END IF;
        END $$;
      `);

      // The database, not each caller, owns the App→runtime binding invariant. Direct SQL writes,
      // old code paths, schedule workers, and upgrades all converge on the App's pipeline.
      await tx.execute(sql`
        CREATE OR REPLACE FUNCTION offgrid_sync_owned_agent_binding()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE app_pipeline text;
        BEGIN
          IF OLD.owner_app_id IS NOT NULL AND NEW.owner_app_id IS NULL THEN
            RAISE EXCEPTION 'owned runtime agent cannot be detached from its App';
          END IF;
          IF NEW.owner_app_id IS NOT NULL THEN
            SELECT pipeline_id INTO app_pipeline FROM apps
            WHERE id = NEW.owner_app_id AND org_id = NEW.org_id;
            IF NOT FOUND THEN
              RAISE EXCEPTION 'owner App % is missing from org %', NEW.owner_app_id, NEW.org_id;
            END IF;
            NEW.pipeline_id := app_pipeline;
          END IF;
          RETURN NEW;
        END $$;
        DROP TRIGGER IF EXISTS custom_agents_owned_binding_guard ON custom_agents;
        CREATE TRIGGER custom_agents_owned_binding_guard
          BEFORE INSERT OR UPDATE OF owner_app_id, org_id, pipeline_id ON custom_agents
          FOR EACH ROW EXECUTE FUNCTION offgrid_sync_owned_agent_binding();

        CREATE OR REPLACE FUNCTION offgrid_propagate_app_pipeline_binding()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          UPDATE custom_agents SET pipeline_id = NEW.pipeline_id
          WHERE owner_app_id = NEW.id AND org_id = NEW.org_id;
          RETURN NEW;
        END $$;
        DROP TRIGGER IF EXISTS apps_pipeline_binding_sync ON apps;
        CREATE TRIGGER apps_pipeline_binding_sync
          AFTER UPDATE OF pipeline_id ON apps
          FOR EACH ROW WHEN (OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id)
          EXECUTE FUNCTION offgrid_propagate_app_pipeline_binding();
      `);
    })
    .catch((e) => {
      appsEnsure = null;
      throw e;
    });
  return appsEnsure;
}

/** Explicit, idempotent upgrade hook used by deploy verification and the real-Postgres proof. */
export async function backfillAppOwnedRuntimeAgents(): Promise<void> {
  await ensureAppsSchema();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('offgrid_schema_ddl'));`);
    await runAppOwnershipBackfill((query) => tx.execute(query));
  });
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

// ─── SOP / template reuse (#TEMPLATE-REUSE) ────────────────────────────────────
// Cross-team workflow-template library + app cloning. The pure rules live in app-clone.ts and
// app-template-vars.ts; this section is the I/O adapter that reads the app's lineage/template columns
// and persists a clone or a template-publish. It never re-implements the clone/substitution rule.

/** A row from the org/public TEMPLATE library — an app published as a reusable SOP. */
export interface TemplateView {
  id: string;
  orgId: string;
  ownerId: string;
  title: string;
  summary: string;
  visibility: 'private' | 'org' | 'public';
  slug?: string;
  stepCount: number;
  templateVars: TemplateVarSchema;
  updatedAt: string;
}

/** Raised when a template publish is rejected because its declared var schema is incoherent. */
export class TemplateVarSchemaError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(`invalid template variable schema: ${errors.join('; ')}`);
    this.name = 'TemplateVarSchemaError';
    this.errors = errors;
  }
}

/** Raised when a clone/adoption produced honest gaps (missing/unbound/undeclared vars). */
export class TemplateBindError extends Error {
  bind: BindResult;
  constructor(bind: BindResult) {
    const gaps = [
      bind.missingRequired.length ? `missing required: ${bind.missingRequired.join(', ')}` : '',
      bind.unbound.length ? `unbound: ${bind.unbound.join(', ')}` : '',
      bind.undeclared.length ? `undeclared: ${bind.undeclared.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    super(`template variables not fully bound: ${gaps}`);
    this.name = 'TemplateBindError';
    this.bind = bind;
  }
}

function toTemplateVars(value: unknown): TemplateVarSchema {
  if (value && typeof value === 'object' && Array.isArray((value as TemplateVarSchema).vars)) {
    return value as TemplateVarSchema;
  }
  return { vars: [] };
}

// ─── getTemplateVars — the declared var schema of an app (empty if none) ────────
export async function getTemplateVars(id: string, orgId: string): Promise<TemplateVarSchema> {
  await ensureAppsSchema();
  const [row] = await db
    .select({ templateVars: apps.templateVars })
    .from(apps)
    .where(and(eq(apps.id, id), eq(apps.orgId, orgId || DEFAULT_ORG)))
    .limit(1);
  return toTemplateVars(row?.templateVars);
}

// ─── getLineage — provenance of a cloned/adopted app (null if authored) ─────────
export async function getLineage(id: string, orgId: string): Promise<AppLineage | null> {
  await ensureAppsSchema();
  const [row] = await db
    .select({ lineage: apps.lineage })
    .from(apps)
    .where(and(eq(apps.id, id), eq(apps.orgId, orgId || DEFAULT_ORG)))
    .limit(1);
  return (row?.lineage as AppLineage | null) ?? null;
}

// ─── cloneApp — persist a deep clone of an app into a (possibly different) org ──
// The pure cloneAppSpec decides WHAT carries over / resets + records lineage; this fn does the I/O:
// mint the id, insert the row with its lineage + (optional) inherited template var schema. When
// `provided` values are supplied (a template adoption), the pure binder substitutes them and any
// honest gap (missing/unbound/undeclared) fails the clone rather than persisting a half-bound spec.
export async function cloneApp(
  source: AppSpec,
  opts: {
    orgId: string;
    ownerId: string;
    origin: CloneOrigin;
    sourceTemplateId?: string;
    title?: string;
    /** Template-var schema to bind (defaults to the source's own declared schema). */
    varSchema?: TemplateVarSchema;
    /** Adopter-supplied variable values (only meaningful with a var schema). */
    provided?: Record<string, string>;
    now?: Date;
  },
): Promise<AppSpec> {
  await ensureAppsSchema();
  const clonedAt = (opts.now ?? new Date()).toISOString();
  const { spec, lineage } = cloneAppSpec(source, {
    orgId: opts.orgId || DEFAULT_ORG,
    ownerId: opts.ownerId,
    mintId: () => `app_${randomUUID().slice(0, 8)}`,
    origin: opts.origin,
    sourceTemplateId: opts.sourceTemplateId,
    title: opts.title,
    clonedAt,
  });

  // Bind template variables when a schema is in play. An honest gap fails the whole clone.
  let boundSpec = spec;
  const schema = opts.varSchema;
  if (schema && schema.vars.length > 0 && opts.provided) {
    const result = bindTemplateVars(spec, schema, opts.provided);
    if (!result.ok) throw new TemplateBindError(result);
    boundSpec = result.spec;
  }

  const check = validateAppSpec(boundSpec);
  if (!check.ok) throw new AppValidationError(check.errors);

  const [row] = await db
    .insert(apps)
    .values({
      id: boundSpec.id,
      orgId: boundSpec.orgId,
      ownerId: boundSpec.ownerId,
      title: boundSpec.title,
      summary: boundSpec.summary,
      visibility: boundSpec.visibility,
      pipelineId: null,
      slug: null,
      published: false,
      isTemplate: false,
      // A clone is a working app, not a template — it does not inherit the source's `isTemplate`.
      // It keeps the declared var schema (informational) so an operator can see what was parameterized.
      templateVars: (schema ?? null) as never,
      lineage: lineage as never,
      trigger: boundSpec.trigger,
      inputForm: (boundSpec.inputForm ?? null) as never,
      steps: boundSpec.steps as never,
      edges: boundSpec.edges,
    })
    .returning();
  return toAppSpec(row);
}

// ─── publishAppAsTemplate — mark an app a reusable org/public SOP template ──────
// Flips is_template + published, stores the declared {{var}} schema, mints a slug if needed, and
// sets visibility (default 'org' — a template another TEAM adopts). Rejects an incoherent var schema
// via the pure validator (DRY — one rule). The app remains a normal, runnable app too.
export async function publishAppAsTemplate(
  id: string,
  orgId: string,
  opts: { varSchema: TemplateVarSchema; visibility?: 'org' | 'public' },
): Promise<AppSpec | null> {
  await ensureAppsSchema();
  const scopedOrgId = orgId || DEFAULT_ORG;
  const current = await getApp(id, scopedOrgId);
  if (!current) return null;

  const schema: TemplateVarSchema = { vars: opts.varSchema?.vars ?? [] };
  const errors = validateVarSchema(schema, current);
  if (errors.length) throw new TemplateVarSchemaError(errors);

  const visibility = opts.visibility === 'public' ? 'public' : 'org';
  const slug = current.slug ?? mintSlug(current.title);
  const [row] = await db
    .update(apps)
    .set({
      isTemplate: true,
      published: true,
      visibility,
      slug,
      templateVars: schema as never,
      updatedAt: new Date(),
    })
    .where(and(eq(apps.id, id), eq(apps.orgId, scopedOrgId)))
    .returning();
  return row ? toAppSpec(row) : null;
}

// ─── unpublishTemplate — retract an app from the template library ───────────────
// Clears is_template (and the exported var schema). Idempotent; keeps the slug so a re-publish keeps
// the same link. Returns null if the app isn't in the org. Does NOT delete the app itself.
export async function unpublishTemplate(id: string, orgId: string): Promise<AppSpec | null> {
  await ensureAppsSchema();
  const scopedOrgId = orgId || DEFAULT_ORG;
  const [row] = await db
    .update(apps)
    .set({ isTemplate: false, templateVars: null, updatedAt: new Date() })
    .where(and(eq(apps.id, id), eq(apps.orgId, scopedOrgId)))
    .returning();
  return row ? toAppSpec(row) : null;
}

// ─── listTemplates — the SOP library visible to an org ──────────────────────────
// A viewer sees templates that are (a) their own org's org-visible templates, OR (b) any public
// template from any org (cross-team adoption). Newest first. This is the library surface's read.
export async function listTemplates(orgId: string): Promise<TemplateView[]> {
  await ensureAppsSchema();
  const scopedOrgId = orgId || DEFAULT_ORG;
  const rows = await db
    .select()
    .from(apps)
    .where(
      and(
        eq(apps.isTemplate, true),
        or(
          eq(apps.visibility, 'public'),
          and(eq(apps.orgId, scopedOrgId), eq(apps.visibility, 'org')),
        ),
      ),
    )
    .orderBy(desc(apps.updatedAt));
  return rows
    .filter((r) => !hideDemoTestArtifact(r.orgId, { title: r.title, ownerId: r.ownerId }))
    .map(toTemplateView);
}

// ─── getTemplate — one template by id, honouring the same visibility rule ───────
export async function getTemplate(id: string, orgId: string): Promise<TemplateView | null> {
  await ensureAppsSchema();
  const scopedOrgId = orgId || DEFAULT_ORG;
  const [row] = await db
    .select()
    .from(apps)
    .where(and(eq(apps.id, id), eq(apps.isTemplate, true)))
    .limit(1);
  if (!row) return null;
  const visible =
    row.visibility === 'public' || (row.orgId === scopedOrgId && row.visibility === 'org');
  return visible ? toTemplateView(row) : null;
}

function toTemplateView(row: App): TemplateView {
  return {
    id: row.id,
    orgId: row.orgId,
    ownerId: row.ownerId,
    title: row.title,
    summary: row.summary,
    visibility: normalizeVisibility(row.visibility),
    slug: row.slug ?? undefined,
    stepCount: Array.isArray(row.steps) ? row.steps.length : 0,
    templateVars: toTemplateVars(row.templateVars),
    updatedAt: (row.updatedAt instanceof Date
      ? row.updatedAt
      : new Date(row.updatedAt as unknown as string)
    ).toISOString(),
  };
}

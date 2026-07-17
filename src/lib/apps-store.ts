// ─── Apps store (Builder Epic #108, Phase 1A) — thin I/O over the `apps` table ──
// CRUD for the unified App entity. SOLID split: the pure model + validation live in app-model.ts;
// this file is the storage adapter only — it validates via validateAppSpec on every write, scopes
// every read/write to an org (like connectors/templates in store.ts), and returns typed AppSpec.
// It never re-implements a rule that belongs in app-model.ts.

import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { apps, type App } from '@/db/schema';
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
  appsEnsure = (async (): Promise<void> => {
    await db.execute(sql`
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
    await db.execute(sql`ALTER TABLE apps ADD COLUMN IF NOT EXISTS pipeline_id text;`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS apps_org_idx ON apps (org_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS apps_slug_idx ON apps (slug);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS apps_pipeline_idx ON apps (pipeline_id);`);
  })().catch((e) => {
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
  const all = await listApps(orgId);
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
  const current = await getApp(id, orgId);
  if (!current) return null;

  // Merge patch onto the current spec, then validate the resulting whole spec.
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

  const [row] = await db
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
    .where(and(eq(apps.id, id), eq(apps.orgId, orgId || DEFAULT_ORG)))
    .returning();
  return row ? toAppSpec(row) : null;
}

// ─── deleteApp — org-scoped ──────────────────────────────────────────────────────
export async function deleteApp(id: string, orgId: string): Promise<void> {
  await ensureAppsSchema();
  await db.delete(apps).where(and(eq(apps.id, id), eq(apps.orgId, orgId || DEFAULT_ORG)));
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

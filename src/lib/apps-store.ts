// ─── Apps store (Builder Epic #108, Phase 1A) — thin I/O over the `apps` table ──
// CRUD for the unified App entity. SOLID split: the pure model + validation live in app-model.ts;
// this file is the storage adapter only — it validates via validateAppSpec on every write, scopes
// every read/write to an org (like connectors/templates in store.ts), and returns typed AppSpec.
// It never re-implements a rule that belongs in app-model.ts.

import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
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

const DEFAULT_ORG = 'default';

// The mutable part of an AppSpec — everything a caller supplies on create (ids/timestamps are
// minted by the store; slug/published are managed by publishApp).
export type AppSpecInput = Pick<
  AppSpec,
  'title' | 'summary' | 'visibility' | 'trigger' | 'inputForm' | 'steps' | 'edges'
> & { published?: boolean; slug?: string };

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
function specFor(
  id: string,
  orgId: string,
  ownerId: string,
  input: AppSpecInput,
): AppSpec {
  return {
    id,
    orgId,
    ownerId,
    title: input.title,
    summary: input.summary ?? '',
    visibility: normalizeVisibility(input.visibility ?? 'private'),
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
  const [row] = await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);
  return row ? toAppSpec(row) : null;
}

// ─── listApps — all apps in an org, newest first ────────────────────────────────
export async function listApps(orgId: string): Promise<AppSpec[]> {
  const rows = await db
    .select()
    .from(apps)
    .where(eq(apps.orgId, orgId || DEFAULT_ORG))
    .orderBy(desc(apps.createdAt));
  return rows.map(toAppSpec);
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

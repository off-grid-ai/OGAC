// ─── Pipeline store + version adapter (Gateways × Pipelines, the PIPELINE tier) ───────────────────
//
// The impure seam behind the pure rules in pipelines-policy.ts. This file does the I/O:
//   • CRUD over the `pipelines` table (drizzle query-builder; org-scoped via `orgId`).
//   • append-only version snapshots into `pipeline_versions` — EVERY update + publish bumps `version`
//     and writes an immutable snapshot (via the pure snapshotOf/nextVersion).
//   • an idempotent `ensurePipelinesSchema()` self-migrate so the module deploys over SSH before the
//     SQL migration lands (mirrors ensureGatewaysSchema) — CREATE TABLE IF NOT EXISTS + ALTER ADD
//     COLUMN IF NOT EXISTS safety net for both tables. Column names MUST match schema.ts exactly.
//   • an optional cheap enrichment: the bound gateway's name/egress summary (from gateways.ts, DRY).
//
// The governance correctness (validation, effectiveGovernance, canReachData, snapshotOf) lives in the
// PURE pipelines-policy.ts; this file only persists + reads facts.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { pipelines, pipelineVersions } from '@/db/schema';
import type { Pipeline as PipelineRowDb } from '@/db/schema';
import { getGatewayRow } from '@/lib/gateways';
import { egressClassFor } from '@/lib/gateways-policy';
import {
  type DomainRefTokens,
  type PipelineRouting,
  type PipelineShape,
  allowlistReferencesTokens,
  domainMatchTokens,
  normalizeAllowlist,
  normalizeRouting,
  nextVersion,
  snapshotOf,
} from '@/lib/pipelines-policy';

const DEFAULT_ORG = 'default';

// ─── self-migrate safety net (memoized; mirrors ensureGatewaysSchema) ─────────────────────────────
// The canonical schema is the drizzle pgTables in src/db/schema.ts; these CREATE TABLE IF NOT EXISTS
// (+ ALTER ADD COLUMN IF NOT EXISTS) let the store work on a DB that hasn't run the migration yet
// (deploy is rsync-only, no migration step over SSH). Column names MUST match schema.ts exactly.
let ensurePromise: Promise<void> | null = null;
export async function ensurePipelinesSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pipelines (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        owner_id text NOT NULL DEFAULT '',
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        visibility text NOT NULL DEFAULT 'private',
        team_id text,
        gateway_id text,
        default_model text,
        routing jsonb NOT NULL DEFAULT '{}'::jsonb,
        data_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
        policy_overlay jsonb NOT NULL DEFAULT '{}'::jsonb,
        guardrail_overlay jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'draft',
        version integer NOT NULL DEFAULT 1,
        is_template boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    // ALTER ADD COLUMN IF NOT EXISTS safety net — a pre-existing table gains any new column.
    for (const col of [
      "ADD COLUMN IF NOT EXISTS team_id text",
      "ADD COLUMN IF NOT EXISTS gateway_id text",
      "ADD COLUMN IF NOT EXISTS default_model text",
      "ADD COLUMN IF NOT EXISTS routing jsonb NOT NULL DEFAULT '{}'::jsonb",
      "ADD COLUMN IF NOT EXISTS data_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb",
      "ADD COLUMN IF NOT EXISTS policy_overlay jsonb NOT NULL DEFAULT '{}'::jsonb",
      "ADD COLUMN IF NOT EXISTS guardrail_overlay jsonb NOT NULL DEFAULT '{}'::jsonb",
      "ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'",
      "ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1",
      "ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false",
    ]) {
      await db.execute(sql.raw(`ALTER TABLE pipelines ${col};`));
    }
    await db.execute(sql`CREATE INDEX IF NOT EXISTS pipelines_org_idx ON pipelines (org_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS pipelines_gateway_idx ON pipelines (gateway_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS pipelines_team_idx ON pipelines (team_id);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pipeline_versions (
        id text PRIMARY KEY,
        pipeline_id text NOT NULL,
        org_id text NOT NULL DEFAULT 'default',
        version integer NOT NULL,
        snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by text NOT NULL DEFAULT '');
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS pipeline_versions_pipeline_idx ON pipeline_versions (pipeline_id);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── row → pure-shape mapping ──────────────────────────────────────────────────────────────────────
function iso(v: string | Date | null | undefined): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

export interface PipelineView extends PipelineShape {
  createdAt: string | null;
  updatedAt: string | null;
  /** Cheap enrichment: the bound gateway's identity, if one is bound + resolvable. */
  gateway?: { id: string; name: string; kind: string; egressClass: string } | null;
}

function toShape(r: PipelineRowDb): PipelineShape {
  return {
    id: r.id,
    orgId: r.orgId,
    ownerId: r.ownerId,
    teamId: r.teamId ?? null,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    gatewayId: r.gatewayId ?? null,
    defaultModel: r.defaultModel ?? null,
    routing: normalizeRouting(r.routing),
    dataAllowlist: normalizeAllowlist(r.dataAllowlist),
    policyOverlay: (r.policyOverlay as Record<string, unknown>) ?? {},
    guardrailOverlay: (r.guardrailOverlay as Record<string, unknown>) ?? {},
    status: r.status,
    version: r.version,
    isTemplate: r.isTemplate,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function toView(shape: PipelineShape, gateway?: PipelineView['gateway']): PipelineView {
  return {
    ...shape,
    createdAt: iso(shape.createdAt),
    updatedAt: iso(shape.updatedAt),
    gateway: gateway ?? null,
  };
}

/** Resolve the bound gateway's cheap summary, if bound + present. Never throws (best-effort enrich). */
async function gatewaySummary(
  gatewayId: string | null,
  orgId: string,
): Promise<PipelineView['gateway']> {
  if (!gatewayId) return null;
  try {
    const gw = await getGatewayRow(gatewayId, orgId);
    if (!gw) return null;
    return { id: gw.id, name: gw.name, kind: gw.kind, egressClass: egressClassFor(gw.kind) };
  } catch {
    return null;
  }
}

// ─── create input ───────────────────────────────────────────────────────────────────────────────────
export interface CreatePipelineInput {
  name: string;
  description?: string;
  visibility?: string;
  /** M2: the team/BU this pipeline belongs to (null ⇒ no team). */
  teamId?: string | null;
  gatewayId?: string | null;
  defaultModel?: string | null;
  routing?: PipelineRouting;
  dataAllowlist?: string[];
  policyOverlay?: Record<string, unknown>;
  guardrailOverlay?: Record<string, unknown>;
  status?: string;
  isTemplate?: boolean;
  /** Stable id for seeding; omitted ⇒ a random pl_… id. */
  id?: string;
}

export type UpdatePipelinePatch = Partial<Omit<CreatePipelineInput, 'id'>>;

// ─── reads ────────────────────────────────────────────────────────────────────────────────────────

/** List an org's pipelines (with cheap gateway enrichment). Stable order (name asc). */
export async function listPipelines(orgId: string = DEFAULT_ORG): Promise<PipelineView[]> {
  await ensurePipelinesSchema();
  const rows = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.orgId, orgId))
    .orderBy(asc(pipelines.name), asc(pipelines.id));
  return Promise.all(
    rows.map(async (r) => {
      const shape = toShape(r);
      return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
    }),
  );
}

/**
 * List the org's pipelines BOUND to a specific gateway (gatewayId = id). Org-scoped, stable order
 * (name asc). Powers the gateway detail's "Pipelines running on this gateway" section — a read-only
 * filter over the same rows as listPipelines, so it can never diverge from the canonical mapping.
 */
export async function listPipelinesByGateway(
  gatewayId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView[]> {
  await ensurePipelinesSchema();
  const rows = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.orgId, orgId), eq(pipelines.gatewayId, gatewayId)))
    .orderBy(asc(pipelines.name), asc(pipelines.id));
  return Promise.all(
    rows.map(async (r) => {
      const shape = toShape(r);
      return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
    }),
  );
}

// ─── Reverse edges: pipelines that REFERENCE a data/library entity ──────────────────────────────────
// The forward edge (a pipeline names its gateway/domains) already exists; these expose the REVERSE so
// a data-domain / connector / tool / eval can show "referenced by N pipelines". We read the org's
// pipelines once and filter in memory with the PURE matcher (allowlistReferencesTokens) — the
// dataAllowlist is free-text (ids OR labels OR aliases), so a pure token match is the only correct
// join. Org-scoped: NEVER returns a pipeline from another tenant.

/**
 * Pipelines whose data ceiling (dataAllowlist) references the given data-domain — matched against the
 * domain's id ∪ label ∪ aliases (case-insensitive). Stable order (name asc). Powers the "referenced by
 * pipelines" panel on the data-domain detail (mirrors the connector's "Bound data domains" card).
 */
export async function listPipelinesByDomain(
  domain: DomainRefTokens,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView[]> {
  const tokens = domainMatchTokens(domain);
  if (!tokens.length) return [];
  const all = await listPipelines(orgId);
  return all.filter((p) => allowlistReferencesTokens(p.dataAllowlist, tokens));
}

/**
 * Pipelines whose data ceiling references ANY of the given data-domains — used by the connector detail
 * ("referenced by pipelines"): a connector is reached by a pipeline transitively through the domains
 * bound to it. Pass the connector's bound domains; returns the de-duped union, stable order. Org-scoped.
 */
export async function listPipelinesByDomains(
  domains: DomainRefTokens[],
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView[]> {
  const tokenSets = domains.map(domainMatchTokens).filter((t) => t.length);
  if (!tokenSets.length) return [];
  const all = await listPipelines(orgId);
  return all.filter((p) => tokenSets.some((tokens) => allowlistReferencesTokens(p.dataAllowlist, tokens)));
}

/**
 * Pipelines whose data ceiling references ANY of the raw reference tokens (id/name/alias) supplied —
 * the generic reverse resolver behind "used by N pipelines" on library entities (tools/evals) whose
 * ceiling reference is a bare id or name. Case-insensitive; org-scoped; stable order.
 */
export async function listPipelinesReferencing(
  refTokens: string[],
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView[]> {
  // Reuse the same normalise/dedupe as a domain's token set (id-slot carries the first ref).
  const tokens = domainMatchTokens({ id: refTokens[0] ?? '', aliases: refTokens.slice(1) });
  if (!tokens.length) return [];
  const all = await listPipelines(orgId);
  return all.filter((p) => allowlistReferencesTokens(p.dataAllowlist, tokens));
}

/** One pipeline by id, org-scoped (with gateway enrichment). Null if absent for this org. */
export async function getPipeline(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView | null> {
  await ensurePipelinesSchema();
  const rows = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)))
    .limit(1);
  if (!rows[0]) return null;
  const shape = toShape(rows[0]);
  return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
}

// ─── create ───────────────────────────────────────────────────────────────────────────────────────

/** Create a pipeline + write its v1 snapshot. Idempotent by stable id (onConflictDoNothing). */
export async function createPipeline(
  input: CreatePipelineInput,
  ownerId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView> {
  await ensurePipelinesSchema();
  const id = input.id ?? `pl_${randomUUID().slice(0, 12)}`;
  const values = {
    id,
    orgId,
    ownerId,
    name: input.name,
    description: input.description ?? '',
    visibility: input.visibility ?? 'private',
    teamId: input.teamId ?? null,
    gatewayId: input.gatewayId ?? null,
    defaultModel: input.defaultModel ?? null,
    routing: normalizeRouting(input.routing),
    dataAllowlist: normalizeAllowlist(input.dataAllowlist),
    policyOverlay: input.policyOverlay ?? {},
    guardrailOverlay: input.guardrailOverlay ?? {},
    status: input.status ?? 'draft',
    version: 1,
    isTemplate: input.isTemplate ?? false,
  };
  const [row] = await db
    .insert(pipelines)
    .values(values)
    .onConflictDoNothing({ target: pipelines.id })
    .returning();

  // onConflictDoNothing returns nothing when the id already existed (idempotent seed) — read it back.
  if (!row) {
    const existing = await getPipeline(id, orgId);
    if (existing) return existing;
    // Different org owns this id, or a race: fall back to a fresh id.
    return createPipeline({ ...input, id: `pl_${randomUUID().slice(0, 12)}` }, ownerId, orgId);
  }

  const shape = toShape(row);
  await writeVersion(shape, 'created', ownerId);
  return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
}

// ─── version snapshot writer (append-only) ─────────────────────────────────────────────────────────
// Exported so the M1 release/rollback orchestrator (pipeline-release.ts) can freeze a `published` or
// `autorollback` snapshot through the SAME append-only path every other mutation uses — the Versions
// tab reads these verbatim, so a rollback shows up in history exactly like a publish/edit.
export async function writePipelineVersion(
  shape: PipelineShape,
  note: string,
  by: string,
): Promise<void> {
  return writeVersion(shape, note, by);
}

async function writeVersion(shape: PipelineShape, note: string, by: string): Promise<void> {
  await db
    .insert(pipelineVersions)
    .values({
      id: `plv_${randomUUID().slice(0, 12)}`,
      pipelineId: shape.id,
      orgId: shape.orgId,
      version: shape.version,
      snapshot: snapshotOf(shape) as unknown as Record<string, unknown>,
      note,
      createdBy: by,
    })
    .onConflictDoNothing({ target: pipelineVersions.id });
}

// ─── update — bumps version + writes a snapshot on EVERY update ────────────────────────────────────
export async function updatePipeline(
  id: string,
  patch: UpdatePipelinePatch,
  orgId: string = DEFAULT_ORG,
  editedBy: string = '',
): Promise<PipelineView | null> {
  await ensurePipelinesSchema();
  const current = await getPipeline(id, orgId);
  if (!current) return null;

  const version = nextVersion(current.version);
  const set: Record<string, unknown> = { version, updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (patch.teamId !== undefined) set.teamId = patch.teamId ?? null;
  if (patch.gatewayId !== undefined) set.gatewayId = patch.gatewayId ?? null;
  if (patch.defaultModel !== undefined) set.defaultModel = patch.defaultModel ?? null;
  if (patch.routing !== undefined) set.routing = normalizeRouting(patch.routing);
  if (patch.dataAllowlist !== undefined) set.dataAllowlist = normalizeAllowlist(patch.dataAllowlist);
  if (patch.policyOverlay !== undefined) set.policyOverlay = patch.policyOverlay ?? {};
  if (patch.guardrailOverlay !== undefined) set.guardrailOverlay = patch.guardrailOverlay ?? {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.isTemplate !== undefined) set.isTemplate = patch.isTemplate;

  const [row] = await db
    .update(pipelines)
    .set(set)
    .where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)))
    .returning();
  if (!row) return null;

  const shape = toShape(row);
  await writeVersion(shape, 'edited', editedBy);
  return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
}

// ─── ownership / team metadata mutations (M2) — do NOT bump version or snapshot ─────────────────────
// Owner + team are OWNERSHIP metadata, orthogonal to the versioned governance config: reassigning an
// owner or moving a pipeline between teams must NOT create a new governance version (a version freezes
// the config, not who owns it). These two thin writers set only the metadata column, org-scoped. The
// audit trail (pipeline.reassign / pipeline.team) is written by the route, not here.

/** Reassign a pipeline's owner. Org-scoped; touches only owner_id + updated_at. Null if absent. */
export async function reassignPipelineOwner(
  id: string,
  newOwnerId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView | null> {
  await ensurePipelinesSchema();
  const [row] = await db
    .update(pipelines)
    .set({ ownerId: newOwnerId, updatedAt: new Date() })
    .where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)))
    .returning();
  if (!row) return null;
  const shape = toShape(row);
  return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
}

/** Assign/clear a pipeline's team (null clears it). Org-scoped; touches only team_id + updated_at. */
export async function setPipelineTeam(
  id: string,
  teamId: string | null,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView | null> {
  await ensurePipelinesSchema();
  const [row] = await db
    .update(pipelines)
    .set({ teamId: teamId, updatedAt: new Date() })
    .where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)))
    .returning();
  if (!row) return null;
  const shape = toShape(row);
  return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
}

/** List an org's pipelines that belong to a given team (stable order). Powers the team detail. */
export async function listPipelinesByTeam(
  teamId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineView[]> {
  await ensurePipelinesSchema();
  const rows = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.orgId, orgId), eq(pipelines.teamId, teamId)))
    .orderBy(asc(pipelines.name), asc(pipelines.id));
  return Promise.all(
    rows.map(async (r) => {
      const shape = toShape(r);
      return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
    }),
  );
}

// ─── publish — status → published + version bump + snapshot ────────────────────────────────────────
export async function publishPipeline(
  id: string,
  orgId: string = DEFAULT_ORG,
  by: string = '',
): Promise<PipelineView | null> {
  await ensurePipelinesSchema();
  const current = await getPipeline(id, orgId);
  if (!current) return null;
  const version = nextVersion(current.version);
  const [row] = await db
    .update(pipelines)
    .set({ status: 'published', version, updatedAt: new Date() })
    .where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)))
    .returning();
  if (!row) return null;
  const shape = toShape(row);
  await writeVersion(shape, 'published', by);
  return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
}

// ─── rollback — restore a prior version's config as the live config (M1 auto-rollback I/O) ──────────
// Given the FROZEN snapshot of a prior good version, write its governance config back onto the live
// pipeline row (status → published, since we're restoring a published version), bump the version, and
// freeze an `autorollback` snapshot carrying the restored config + a note explaining WHY. The pure
// pickRollbackTarget (rollback-policy.ts) chose WHICH version; this only persists the restore. The
// caller (pipeline-release.ts) supplies the note + audits. Never invents a target — a null snapshot
// is a no-op returning null so the caller reports "nothing to roll back to" honestly.
export async function rollbackPipeline(
  id: string,
  restore: {
    name?: string;
    description?: string;
    visibility?: string;
    gatewayId?: string | null;
    defaultModel?: string | null;
    routing?: unknown;
    dataAllowlist?: string[];
    policyOverlay?: Record<string, unknown>;
    guardrailOverlay?: Record<string, unknown>;
    isTemplate?: boolean;
  },
  note: string,
  orgId: string = DEFAULT_ORG,
  by: string = '',
): Promise<PipelineView | null> {
  await ensurePipelinesSchema();
  const current = await getPipeline(id, orgId);
  if (!current) return null;
  const version = nextVersion(current.version);
  const set: Record<string, unknown> = {
    status: 'published',
    version,
    updatedAt: new Date(),
  };
  if (restore.name !== undefined) set.name = restore.name;
  if (restore.description !== undefined) set.description = restore.description;
  if (restore.visibility !== undefined) set.visibility = restore.visibility;
  if (restore.gatewayId !== undefined) set.gatewayId = restore.gatewayId ?? null;
  if (restore.defaultModel !== undefined) set.defaultModel = restore.defaultModel ?? null;
  if (restore.routing !== undefined) set.routing = normalizeRouting(restore.routing);
  if (restore.dataAllowlist !== undefined) set.dataAllowlist = normalizeAllowlist(restore.dataAllowlist);
  if (restore.policyOverlay !== undefined) set.policyOverlay = restore.policyOverlay ?? {};
  if (restore.guardrailOverlay !== undefined) set.guardrailOverlay = restore.guardrailOverlay ?? {};
  if (restore.isTemplate !== undefined) set.isTemplate = restore.isTemplate;

  const [row] = await db
    .update(pipelines)
    .set(set)
    .where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)))
    .returning();
  if (!row) return null;
  const shape = toShape(row);
  // Note is capped to the DB text column's practical width; the pure rollbackNote keeps it short.
  await writeVersion(shape, note.slice(0, 200), by);
  return toView(shape, await gatewaySummary(shape.gatewayId, orgId));
}

// ─── delete ─────────────────────────────────────────────────────────────────────────────────────────
export async function deletePipeline(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensurePipelinesSchema();
  const rows = await db
    .delete(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)))
    .returning({ id: pipelines.id });
  if (rows.length > 0) {
    // Version history is append-only lineage — clean it up with the pipeline (org-scoped).
    await db
      .delete(pipelineVersions)
      .where(and(eq(pipelineVersions.pipelineId, id), eq(pipelineVersions.orgId, orgId)));
  }
  return rows.length > 0;
}

// ─── version history read ─────────────────────────────────────────────────────────────────────────
export interface PipelineVersionView {
  id: string;
  pipelineId: string;
  version: number;
  note: string;
  snapshot: Record<string, unknown>;
  createdAt: string | null;
  createdBy: string;
}

/** List a pipeline's version history, newest first. Org-scoped. */
export async function listPipelineVersions(
  pipelineId: string,
  orgId: string = DEFAULT_ORG,
): Promise<PipelineVersionView[]> {
  await ensurePipelinesSchema();
  const rows = await db
    .select()
    .from(pipelineVersions)
    .where(and(eq(pipelineVersions.pipelineId, pipelineId), eq(pipelineVersions.orgId, orgId)))
    .orderBy(desc(pipelineVersions.version), desc(pipelineVersions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    pipelineId: r.pipelineId,
    version: r.version,
    note: r.note,
    snapshot: (r.snapshot as Record<string, unknown>) ?? {},
    createdAt: iso(r.createdAt),
    createdBy: r.createdBy,
  }));
}

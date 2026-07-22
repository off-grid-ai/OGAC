// I/O adapter for `drift_projects` — the ONLY place the monitoring SoR touches the DB. The pure
// validation/normalization + history/trend shaping live in evidently-monitoring.ts; this module does
// org-scoped CRUD, an idempotent self-migrate (so it deploys over SSH with no migration step — same
// pattern as exporters/store.ts + drift-runs.ts), and COMPOSES a project's report history + trend by
// reading the EXISTING retained drift-run store READ-ONLY (listDriftRuns).
//
// HONESTY NOTE: `drift_runs` carries no per-project/per-dataset foreign key (and that store is owned
// elsewhere — we do not edit it), so a project's report history is the ORG's retained drift runs. The
// project supplies the naming, the dataset label, and the breach threshold that the trend/verdict key
// off. Association is therefore org-level + descriptive, not a per-run join — stated plainly rather
// than faking a per-dataset link the underlying runs don't have.

import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { driftProjects } from '@/db/schema';
import type { DriftProjectRow } from '@/db/schema';
import { listDriftRuns } from '@/lib/drift-runs';
import {
  buildTrendSeries,
  normalizeReportHistory,
  projectSignal,
  type DriftReportEntry,
  type NormalizedDriftProject,
  type ProjectSignal,
  type TrendGranularity,
  type TrendSeries,
} from '@/lib/evidently-monitoring';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// How many retained runs feed a project's history/trend. Bounded so a busy org can't unbounded-scan.
const RUN_WINDOW = 200;

let ensurePromise: Promise<void> | null = null;
export async function ensureDriftProjectsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS drift_projects (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        dataset text NOT NULL DEFAULT '',
        drift_threshold double precision NOT NULL DEFAULT 0.25,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS drift_projects_org_idx ON drift_projects (org_id);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── view ───────────────────────────────────────────────────────────────────────────────────────
function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

export interface DriftProjectView {
  id: string;
  name: string;
  description: string;
  dataset: string;
  driftThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export function toProjectView(row: DriftProjectRow): DriftProjectView {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    dataset: row.dataset ?? '',
    driftThreshold: Number(row.driftThreshold),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// ─── CRUD (org-scoped) ─────────────────────────────────────────────────────────────────────────
export async function listDriftProjects(orgId: string = DEFAULT_ORG): Promise<DriftProjectView[]> {
  await ensureDriftProjectsSchema();
  const rows = await db
    .select()
    .from(driftProjects)
    .where(eq(driftProjects.orgId, orgId || DEFAULT_ORG))
    .orderBy(asc(driftProjects.name), asc(driftProjects.createdAt));
  return rows.map(toProjectView);
}

export async function getDriftProject(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<DriftProjectView | null> {
  await ensureDriftProjectsSchema();
  const rows = await db
    .select()
    .from(driftProjects)
    .where(and(eq(driftProjects.id, id), eq(driftProjects.orgId, orgId || DEFAULT_ORG)))
    .limit(1);
  return rows[0] ? toProjectView(rows[0]) : null;
}

export async function createDriftProject(
  input: NormalizedDriftProject,
  orgId: string = DEFAULT_ORG,
): Promise<DriftProjectView> {
  await ensureDriftProjectsSchema();
  const [row] = await db
    .insert(driftProjects)
    .values({
      id: randomUUID(),
      orgId: orgId || DEFAULT_ORG,
      name: input.name,
      description: input.description,
      dataset: input.dataset,
      driftThreshold: input.driftThreshold,
    })
    .returning();
  return toProjectView(row);
}

export async function updateDriftProject(
  id: string,
  orgId: string,
  input: NormalizedDriftProject,
): Promise<DriftProjectView | null> {
  await ensureDriftProjectsSchema();
  const [row] = await db
    .update(driftProjects)
    .set({
      name: input.name,
      description: input.description,
      dataset: input.dataset,
      driftThreshold: input.driftThreshold,
      updatedAt: new Date(),
    })
    .where(and(eq(driftProjects.id, id), eq(driftProjects.orgId, orgId || DEFAULT_ORG)))
    .returning();
  return row ? toProjectView(row) : null;
}

export async function deleteDriftProject(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  await ensureDriftProjectsSchema();
  const rows = await db
    .delete(driftProjects)
    .where(and(eq(driftProjects.id, id), eq(driftProjects.orgId, orgId || DEFAULT_ORG)))
    .returning({ id: driftProjects.id });
  return rows.length > 0;
}

// ─── composition: project + report history + trend (from retained drift runs) ─────────────────────
export interface DriftProjectDetail {
  project: DriftProjectView;
  history: DriftReportEntry[];
  trend: TrendSeries;
}

export async function getDriftProjectDetail(
  id: string,
  orgId: string = DEFAULT_ORG,
  granularity: TrendGranularity = 'day',
): Promise<DriftProjectDetail | null> {
  const project = await getDriftProject(id, orgId);
  if (!project) return null;
  const runs = await listDriftRuns(RUN_WINDOW, orgId || DEFAULT_ORG);
  return {
    project,
    history: normalizeReportHistory(runs),
    trend: buildTrendSeries(runs, { threshold: project.driftThreshold, granularity }),
  };
}

export interface DriftProjectListItem extends DriftProjectView {
  signal: ProjectSignal;
}

// List projects with a compact per-project signal (report count / latest / trend direction / breach
// count). Reads the org's retained runs ONCE and applies each project's own threshold.
export async function listDriftProjectsWithSignal(
  orgId: string = DEFAULT_ORG,
): Promise<DriftProjectListItem[]> {
  const projects = await listDriftProjects(orgId);
  if (projects.length === 0) return [];
  const runs = await listDriftRuns(RUN_WINDOW, orgId || DEFAULT_ORG);
  return projects.map((p) => ({ ...p, signal: projectSignal(p.driftThreshold, runs) }));
}

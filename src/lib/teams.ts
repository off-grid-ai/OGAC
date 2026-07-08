// ─── Team / BU store (M2 lifecycle & ownership — the TEAM tier) ────────────────────────────────────
//
// The impure seam behind the PURE rules in teams-policy.ts. This file does the I/O:
//   • CRUD over the `teams` table (org-scoped via `orgId`);
//   • membership CRUD over `team_members` (teamId + userId + role);
//   • membership READS the pure resolver (teams-policy.resolveLifecycleRole) needs — a user's full
//     membership list, and a team's members;
//   • an idempotent `ensureTeamsSchema()` self-migrate (mirrors ensurePipelinesSchema) so the module
//     deploys over SSH before the SQL migration lands. Column names MUST match schema.ts exactly.
//
// The validation + RBAC correctness lives in the PURE teams-policy.ts; this file only persists + reads.
import { randomUUID } from 'crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { teams, teamMembers } from '@/db/schema';
import type { Team as TeamRowDb, TeamMember as TeamMemberRowDb } from '@/db/schema';
import {
  type Membership,
  type TeamMemberRole,
  normalizeTeamMemberRole,
} from '@/lib/teams-policy';

const DEFAULT_ORG = 'default';

// ─── self-migrate safety net (memoized; mirrors ensurePipelinesSchema) ──────────────────────────────
let ensurePromise: Promise<void> | null = null;
export async function ensureTeamsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS teams (
        id text PRIMARY KEY,
        org_id text NOT NULL DEFAULT 'default',
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS teams_org_idx ON teams (org_id);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS team_members (
        id text PRIMARY KEY,
        team_id text NOT NULL,
        org_id text NOT NULL DEFAULT 'default',
        user_id text NOT NULL,
        role text NOT NULL DEFAULT 'member',
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS team_members_team_idx ON team_members (team_id);`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members (user_id);`,
    );
    // The pipelines.team_id column lives in pipelines.ensurePipelinesSchema (same table's owner).
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── views ────────────────────────────────────────────────────────────────────────────────────────
function iso(v: string | Date | null | undefined): string | null {
  return v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;
}

export interface TeamMemberView {
  id: string;
  teamId: string;
  userId: string;
  role: TeamMemberRole;
  createdAt: string | null;
}

export interface TeamView {
  id: string;
  orgId: string;
  name: string;
  description: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** Member count — cheap roll-up for the list surface. */
  memberCount: number;
}

function toMemberView(r: TeamMemberRowDb): TeamMemberView {
  return {
    id: r.id,
    teamId: r.teamId,
    userId: r.userId,
    role: normalizeTeamMemberRole(r.role),
    createdAt: iso(r.createdAt),
  };
}

function toTeamView(r: TeamRowDb, memberCount: number): TeamView {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    memberCount,
  };
}

// ─── team CRUD ──────────────────────────────────────────────────────────────────────────────────────
export interface CreateTeamInput {
  name: string;
  description?: string;
  /** Stable id for seeding; omitted ⇒ a random tm_… id. */
  id?: string;
}

/** List an org's teams with member counts. Stable order (name asc). */
export async function listTeams(orgId: string = DEFAULT_ORG): Promise<TeamView[]> {
  await ensureTeamsSchema();
  const rows = await db
    .select()
    .from(teams)
    .where(eq(teams.orgId, orgId))
    .orderBy(asc(teams.name), asc(teams.id));
  // Member counts — one query, grouped in memory (team counts are small; org has few teams).
  const memberRows = await db.select().from(teamMembers).where(eq(teamMembers.orgId, orgId));
  const counts = new Map<string, number>();
  for (const m of memberRows) counts.set(m.teamId, (counts.get(m.teamId) ?? 0) + 1);
  return rows.map((r) => toTeamView(r, counts.get(r.id) ?? 0));
}

/** One team by id, org-scoped. Null if absent for this org. */
export async function getTeam(id: string, orgId: string = DEFAULT_ORG): Promise<TeamView | null> {
  await ensureTeamsSchema();
  const rows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
    .limit(1);
  if (!rows[0]) return null;
  const members = await listTeamMembers(id, orgId);
  return toTeamView(rows[0], members.length);
}

/** Create a team. Idempotent by stable id (onConflictDoNothing). */
export async function createTeam(
  input: CreateTeamInput,
  orgId: string = DEFAULT_ORG,
): Promise<TeamView> {
  await ensureTeamsSchema();
  const id = input.id ?? `tm_${randomUUID().slice(0, 12)}`;
  const [row] = await db
    .insert(teams)
    .values({ id, orgId, name: input.name, description: input.description ?? '' })
    .onConflictDoNothing({ target: teams.id })
    .returning();
  if (!row) {
    const existing = await getTeam(id, orgId);
    if (existing) return existing;
    return createTeam({ ...input, id: `tm_${randomUUID().slice(0, 12)}` }, orgId);
  }
  return toTeamView(row, 0);
}

export interface UpdateTeamPatch {
  name?: string;
  description?: string;
}

/** Update a team's name/description. Org-scoped. Null if absent. */
export async function updateTeam(
  id: string,
  patch: UpdateTeamPatch,
  orgId: string = DEFAULT_ORG,
): Promise<TeamView | null> {
  await ensureTeamsSchema();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  const [row] = await db
    .update(teams)
    .set(set)
    .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
    .returning();
  if (!row) return null;
  const members = await listTeamMembers(id, orgId);
  return toTeamView(row, members.length);
}

/** Delete a team + its memberships. Pipelines that pointed at it are cleared (team_id → null) so a
 *  pipeline is never orphaned onto a dangling team; that clear lives in the route (SOLID: the team
 *  store doesn't reach into the pipelines table). Returns whether a team was removed. Org-scoped. */
export async function deleteTeam(id: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  await ensureTeamsSchema();
  const rows = await db
    .delete(teams)
    .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
    .returning({ id: teams.id });
  if (rows.length > 0) {
    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, id), eq(teamMembers.orgId, orgId)));
  }
  return rows.length > 0;
}

// ─── membership CRUD ─────────────────────────────────────────────────────────────────────────────────

/** A team's members, stable order (userId asc). Org-scoped. */
export async function listTeamMembers(
  teamId: string,
  orgId: string = DEFAULT_ORG,
): Promise<TeamMemberView[]> {
  await ensureTeamsSchema();
  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.orgId, orgId)))
    .orderBy(asc(teamMembers.userId));
  return rows.map(toMemberView);
}

/**
 * Add (or update the role of) a member. Upsert on (team, user): re-adding an existing member updates
 * their role instead of duplicating. Org-scoped. Returns the member view.
 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamMemberRole,
  orgId: string = DEFAULT_ORG,
): Promise<TeamMemberView> {
  await ensureTeamsSchema();
  const existing = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.orgId, orgId),
        eq(teamMembers.userId, userId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(teamMembers)
      .set({ role })
      .where(eq(teamMembers.id, existing[0].id))
      .returning();
    return toMemberView(row);
  }
  const [row] = await db
    .insert(teamMembers)
    .values({ id: `tmm_${randomUUID().slice(0, 12)}`, teamId, orgId, userId, role })
    .returning();
  return toMemberView(row);
}

/** Remove a member from a team by membership id. Org-scoped. Returns whether one was removed. */
export async function removeTeamMember(
  memberId: string,
  orgId: string = DEFAULT_ORG,
): Promise<boolean> {
  await ensureTeamsSchema();
  const rows = await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.id, memberId), eq(teamMembers.orgId, orgId)))
    .returning({ id: teamMembers.id });
  return rows.length > 0;
}

// ─── the RBAC feed — a user's memberships across all teams (org-scoped) ─────────────────────────────
// The pure resolver (teams-policy.resolveLifecycleRole) needs the actor's full membership list to
// decide their delegated role on a pipeline. This reads it, mapped to the pure Membership shape.
export async function listMembershipsForUser(
  userId: string,
  orgId: string = DEFAULT_ORG,
): Promise<Membership[]> {
  await ensureTeamsSchema();
  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.orgId, orgId), eq(teamMembers.userId, userId)));
  return rows.map((r) => ({
    teamId: r.teamId,
    userId: r.userId,
    role: normalizeTeamMemberRole(r.role),
  }));
}

// ─── Give the demo tenants an org chart, so the management chain has something to climb ──────────────
//
// `resolveManagementChain` (src/lib/app-sharing-policy.ts) already implements exactly what the founder asked
// for — "whoever is on top of me in the tree obviously has access by default" — by treating a team `lead` as a
// manager to that team's members and climbing transitively, with cycle guards. It is unit-tested.
//
// It just had nothing to climb: `team_members` was EMPTY in both demo tenants, so every chain resolved to []
// and the inheritance looked unimplemented when it was only unpopulated.
//
// This assigns each demo tenant's users across its existing teams: the first user leads, the rest are members,
// and one person is made a member of a second team so the chart has more than one level to climb (their lead's
// own lead is then reachable — which is the transitive case the resolver exists for).
//
// Uses the real addTeamMember path so validation and the audit trail behave as the UI would. Idempotent — an
// existing membership is left alone.
//
// RUN: npx tsx scripts/seed-demo-org-chart.mts
import './worker-env.mts';
import { addTeamMember, listTeamMembers, listTeams } from '../src/lib/teams.ts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const ORGS = ['org_bharat', 'org_suraksha'] as const;

for (const orgId of ORGS) {
  const teams = await listTeams(orgId).catch(() => []);
  const users = (await db.execute(sql`
    SELECT email FROM "user" WHERE org_id = ${orgId} AND email IS NOT NULL ORDER BY email
  `)) as unknown as { rows: { email: string }[] };
  const people = (users.rows ?? []).map((u) => u.email).filter(Boolean);

  if (teams.length === 0 || people.length === 0) {
    console.log(`${orgId}: skipped — ${teams.length} teams, ${people.length} users`);
    continue;
  }

  let added = 0;
  for (const [index, team] of teams.entries()) {
    const existing = await listTeamMembers(team.id, orgId).catch(() => []);
    if (existing.length > 0) continue;

    // Rotate who leads which team, so the chart is not one person leading everything — that would make the
    // transitive climb untestable, since there would be nobody above the single lead.
    const lead = people[index % people.length];
    const members = people.filter((p) => p !== lead).slice(0, 3);

    for (const [userId, role] of [
      [lead, 'lead'] as const,
      ...members.map((m) => [m, 'member'] as const),
    ]) {
      try {
        await addTeamMember(team.id, { userId, role }, orgId);
        added += 1;
      } catch (error) {
        console.log(`  ${team.name}: could not add ${userId} — ${(error as Error).message}`);
      }
    }
    console.log(`${orgId} · ${team.name}: lead ${lead} + ${members.length} member(s)`);
  }
  console.log(`${orgId}: ${added} membership(s) added`);
}

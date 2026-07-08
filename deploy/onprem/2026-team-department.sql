-- M2-a (task #189): DEPARTMENT grouping on the team tier.
--   • adds a nullable `teams.department` (text) so a team can belong to a department (e.g. "Risk",
--     "Operations", "Finance"). This makes the Access surface read as an org chart:
--     department → team → members. A team with no department falls into the "Unassigned" bucket.
--
-- src/db/schema.ts declares teams.department; the app self-migrates at runtime via
-- ensureTeamsSchema() (src/lib/teams.ts) — ALTER TABLE teams ADD COLUMN IF NOT EXISTS department —
-- so the app never references a missing column even before this file runs. This file makes the live
-- DB explicit + replayable for the orchestrator. Idempotent + additive — safe to re-run.
--
-- Apply with (mirrors 2026-teams-lifecycle.sql):
--   ssh -i ~/.ssh/id_ed25519 admin@offgrid-tunnel \
--     "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-team-department.sql

ALTER TABLE teams ADD COLUMN IF NOT EXISTS department text;

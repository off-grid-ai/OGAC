-- M2 (task #187): lifecycle & ownership above the pipeline.
--   • a TEAM/BU tier between org and pipeline — `teams` + `team_members`;
--   • `pipelines.team_id` — the team a pipeline belongs to (delegated RBAC by membership);
--   • the pipeline status enum widens from {draft, published, archived} to the full promotion
--     lifecycle {draft, in_review, published, deprecated} (+ legacy `archived`). status is a plain
--     text column, so NO type migration is needed — the widened vocabulary is enforced in
--     src/lib/pipeline-lifecycle-model.ts. Existing draft/published/archived rows keep working
--     (they're all still valid lifecycle members). No forced re-review of pre-existing pipelines.
--
-- src/db/schema.ts declares teams/team_members + pipelines.team_id; the app self-migrates at runtime:
--   • ensureTeamsSchema()      (src/lib/teams.ts)     — CREATE TABLE IF NOT EXISTS teams/team_members;
--   • ensurePipelinesSchema()  (src/lib/pipelines.ts) — ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS
--                                                        team_id + the pipelines_team_idx index.
-- so the app never references a missing column even before this file runs. This file makes the live
-- DB explicit + replayable for the orchestrator. Idempotent + additive — safe to re-run.
--
-- Apply with (mirrors 2026-eval-runs-pipeline.sql):
--   ssh -i ~/.ssh/id_ed25519 admin@offgrid-tunnel \
--     "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-teams-lifecycle.sql

-- ── team / BU tier ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          text PRIMARY KEY,
  org_id      text NOT NULL DEFAULT 'default',
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teams_org_idx ON teams (org_id);

CREATE TABLE IF NOT EXISTS team_members (
  id         text PRIMARY KEY,
  team_id    text NOT NULL,
  org_id     text NOT NULL DEFAULT 'default',
  user_id    text NOT NULL,               -- the member's email / id
  role       text NOT NULL DEFAULT 'member', -- 'lead' | 'member'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_members_team_idx ON team_members (team_id);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members (user_id);

-- ── pipeline → team edge ──────────────────────────────────────────────────────────────────────────
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS team_id text;
CREATE INDEX IF NOT EXISTS pipelines_team_idx ON pipelines (team_id);

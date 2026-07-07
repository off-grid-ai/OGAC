-- Gateways × Pipelines, the PIPELINE tier: the `pipelines` registry + `pipeline_versions` history.
-- A Pipeline is the reusable, GOVERNED model-access contract — gateway binding + routing/egress leash
-- + hard data allowlist + policy/guardrail overlays + immutable version snapshots. Consumed by apps,
-- agents, and chat. The schema (src/db/schema.ts) declares these tables; the app also self-migrates
-- them at runtime (ensurePipelinesSchema in src/lib/pipelines.ts), so this file just makes the live
-- DB explicit + replayable. Idempotent.
--
-- Apply with:
--   ssh -i ~/.ssh/id_ed25519 admin@offgrid-tunnel \
--     "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-pipelines.sql

CREATE TABLE IF NOT EXISTS pipelines (
  id                text PRIMARY KEY,
  org_id            text NOT NULL DEFAULT 'default',
  owner_id          text NOT NULL DEFAULT '',
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  visibility        text NOT NULL DEFAULT 'private',    -- private | org | public
  gateway_id        text,                                -- the gateway binding (null ⇒ org default)
  default_model     text,                                -- null ⇒ the gateway's own default
  routing           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- fallback chain + egress leash
  data_allowlist    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- HARD data ceiling (domain/class ids)
  policy_overlay    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- inherits org; tightens locked controls
  guardrail_overlay jsonb NOT NULL DEFAULT '{}'::jsonb,   -- inherits org; tightens locked controls
  status            text NOT NULL DEFAULT 'draft',        -- draft | published | archived
  version           integer NOT NULL DEFAULT 1,
  is_template       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipelines_org_idx ON pipelines (org_id);
CREATE INDEX IF NOT EXISTS pipelines_gateway_idx ON pipelines (gateway_id);

-- Immutable config snapshots — one row per publish/edit; append-only. Consumers will later PIN a
-- version, so this is the source of truth for what a pinned version was.
CREATE TABLE IF NOT EXISTS pipeline_versions (
  id           text PRIMARY KEY,
  pipeline_id  text NOT NULL,
  org_id       text NOT NULL DEFAULT 'default',
  version      integer NOT NULL,
  snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,     -- full config at this version, frozen
  note         text NOT NULL DEFAULT '',                -- created | edited | published
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS pipeline_versions_pipeline_idx ON pipeline_versions (pipeline_id);

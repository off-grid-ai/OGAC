-- M4 — Deep data governance (task #190). The CONSOLE-SIDE governance registry over the warehouse:
--   data_assets         — the catalog ("what data do I have")
--   data_classifications— per-asset/column sensitivity + PII tags (drives policy)
--   retention_policies  — per-asset retention window + action (delete/anonymize/archive)
--   erasure_requests    — durable RTBF / subject-erasure request records + resolved cross-plane scope
--
-- The store (src/lib/data-catalog-store.ts) also self-provisions these via CREATE TABLE IF NOT EXISTS
-- on first use (deploy is rsync-only), so applying this file is belt-and-braces. Idempotent + safe to
-- re-run. Column names/types MUST match src/db/schema.ts exactly. Apply with:
--   ssh ... "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-data-governance.sql

CREATE TABLE IF NOT EXISTS data_assets (
  id                   text PRIMARY KEY,
  org_id               text NOT NULL DEFAULT 'default',
  name                 text NOT NULL,
  source               text NOT NULL DEFAULT '',
  connector_id         text,
  domain_id            text,
  kind                 text NOT NULL DEFAULT 'table',
  owner                text NOT NULL DEFAULT '',
  description          text NOT NULL DEFAULT '',
  row_count            integer NOT NULL DEFAULT 0,
  freshness_sla_hours  integer NOT NULL DEFAULT 0,
  last_refresh_at      timestamptz,
  sync_status          text NOT NULL DEFAULT 'unknown',
  sync_error           text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_assets_org_idx       ON data_assets (org_id);
CREATE INDEX IF NOT EXISTS data_assets_connector_idx ON data_assets (connector_id);

CREATE TABLE IF NOT EXISTS data_classifications (
  id          text PRIMARY KEY,
  org_id      text NOT NULL DEFAULT 'default',
  asset_id    text NOT NULL,
  "column"    text,
  level       text NOT NULL DEFAULT 'internal',
  pii_tags    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_classifications_org_idx   ON data_classifications (org_id);
CREATE INDEX IF NOT EXISTS data_classifications_asset_idx ON data_classifications (asset_id);

CREATE TABLE IF NOT EXISTS retention_policies (
  id          text PRIMARY KEY,
  org_id      text NOT NULL DEFAULT 'default',
  asset_id    text NOT NULL,
  retain_days integer NOT NULL DEFAULT 0,
  action      text NOT NULL DEFAULT 'delete',
  legal_hold  boolean NOT NULL DEFAULT false,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retention_policies_org_idx   ON retention_policies (org_id);
CREATE INDEX IF NOT EXISTS retention_policies_asset_idx ON retention_policies (asset_id);

CREATE TABLE IF NOT EXISTS erasure_requests (
  id           text PRIMARY KEY,
  org_id       text NOT NULL DEFAULT 'default',
  subject      text NOT NULL,
  status       text NOT NULL DEFAULT 'recorded',
  scope        jsonb NOT NULL DEFAULT '{}'::jsonb,
  erased_rows  integer NOT NULL DEFAULT 0,
  requested_by text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS erasure_requests_org_idx     ON erasure_requests (org_id);
CREATE INDEX IF NOT EXISTS erasure_requests_subject_idx ON erasure_requests (subject);

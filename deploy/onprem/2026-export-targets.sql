-- M6 (task #192): "good citizen" — export the spine to existing enterprise tooling.
--   `export_targets` is the per-org config for one spine EXPORTER:
--     • kind        — which slice of the spine: 'audit' | 'lineage' | 'metrics';
--     • endpoint    — where to send it (Splunk HEC URL / OpenLineage URL / OTLP collector).
--                     Empty is valid for the metrics SCRAPE mode (Prometheus pulls, nothing to push);
--     • enabled     — whether the exporter runs;
--     • secret_ref  — an OpenBao KEY PATH naming the auth token — NEVER the raw token. The value is
--                     resolved at export time via the existing secret path (mirrors service-credentials).
--     • last_status / last_detail / last_at — the HONEST result of the most recent real test()/export()
--                     call (never fabricated).
--
-- src/db/schema.ts declares export_targets; the app self-migrates at runtime via
-- ensureExportTargetsSchema() (src/lib/exporters/store.ts) — CREATE TABLE IF NOT EXISTS — so the module
-- deploys over SSH before this file runs. This file makes the live DB explicit + replayable for the
-- orchestrator. Idempotent + additive — safe to re-run. Do NOT apply live until the M6 build lands.
--
-- Apply with (mirrors 2026-teams-lifecycle.sql):
--   ssh -i ~/.ssh/id_ed25519 admin@offgrid-tunnel \
--     "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-export-targets.sql

CREATE TABLE IF NOT EXISTS export_targets (
  id          text PRIMARY KEY,
  org_id      text NOT NULL DEFAULT 'default',
  kind        text NOT NULL,                  -- 'audit' | 'lineage' | 'metrics'
  endpoint    text NOT NULL DEFAULT '',
  enabled     boolean NOT NULL DEFAULT true,
  secret_ref  text,                           -- OpenBao key path, never a value
  last_status text,                           -- 'ok' | 'fail' | null (never tested)
  last_detail text,
  last_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS export_targets_org_idx ON export_targets (org_id);

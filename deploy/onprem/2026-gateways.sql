-- Gateways × Pipelines, P1: the `gateways` registry — first-class model-serving endpoints a pipeline
-- runs on (on-prem cluster · OpenAI · Anthropic · OpenRouter …). The schema (src/db/schema.ts)
-- declares this table; the app also self-migrates it at runtime (ensureGatewaysSchema in
-- src/lib/gateways.ts), so this file just makes the live DB explicit + replayable. Idempotent.
--
-- Apply with:
--   ssh -i ~/.ssh/id_ed25519 admin@offgrid-tunnel \
--     "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-gateways.sql
--
-- egress_class is DERIVED from kind (on-prem ⇒ 'on-prem', every cloud kind ⇒ 'cloud') and kept
-- consistent by the store on every write; it is stored so a query can filter without recomputing.

CREATE TABLE IF NOT EXISTS gateways (
  id            text PRIMARY KEY,
  org_id        text NOT NULL DEFAULT 'default',
  name          text NOT NULL,
  kind          text NOT NULL,                       -- on-prem | openai | anthropic | compat
  base_url      text NOT NULL DEFAULT '',
  default_model text NOT NULL DEFAULT '',
  egress_class  text NOT NULL DEFAULT 'cloud',        -- on-prem | cloud (derived from kind)
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gateways_org_idx ON gateways (org_id);

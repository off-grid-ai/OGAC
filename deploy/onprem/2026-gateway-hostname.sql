-- PA-15: per-tenant gateway URLs. Add the provisioned `hostname` column to the `gateways` registry.
-- A per-tenant PROVISIONED gateway carries its OWN unguessable host "<slug5><rand5>-gateway.<apex>"
-- (minted from the tenant slug + a random suffix; see tenantGatewayHost in src/lib/tenant-domain.ts).
-- Nullable — most gateways use the shared "gateway.<apex>". The aggregator/edge resolves the tenant
-- from the inbound Host by matching gatewayFromHost() ↔ this column.
--
-- The schema (src/db/schema.ts) declares this column; the app also self-migrates it at runtime
-- (ensureGatewaysSchema in src/lib/gateways.ts runs the same ALTER … IF NOT EXISTS), so this file
-- just makes the live DB explicit + replayable. Idempotent. Additive — safe to re-run.
--
-- Apply with:
--   ssh -i ~/.ssh/id_ed25519 admin@offgrid-tunnel \
--     "/usr/local/bin/docker exec -i offgrid-console-postgres-1 psql \"$DBURL\"" < 2026-gateway-hostname.sql

ALTER TABLE gateways ADD COLUMN IF NOT EXISTS hostname text;

-- Fast resolve-by-host (partial index — only provisioned rows carry a hostname).
CREATE INDEX IF NOT EXISTS gateways_hostname_idx ON gateways (hostname) WHERE hostname IS NOT NULL;

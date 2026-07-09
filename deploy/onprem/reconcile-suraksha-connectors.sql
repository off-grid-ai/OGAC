-- Reconcile the org_suraksha connectors + data-domains that were applied earlier with WRONG endpoints
-- (they pointed at a non-existent `coreins` DB; the real shared servers are corebank :5433 / policyadmin
-- :3307, and Suraksha gets its OWN isolated database `suraksha` on each — seeded by
-- deploy/onprem/seed-suraksha-dataplane.mjs). Idempotent: safe to run repeatedly. Apply on S1 via the
-- pg client against offgrid_console (see deploy/DEPLOY.md § Database migrations). Equivalent to re-running
-- seed-suraksha-console.mjs (now corrected), but scoped to just the drift + the missing domain.
BEGIN;

-- 1) Repoint the two OLTP connectors at the isolated per-tenant `suraksha` databases.
UPDATE connectors
   SET endpoint = 'postgres://corebank:corebank@127.0.0.1:5433/suraksha',
       description = 'Policy administration OLTP — policies, premiums, claims, KYC, pricing.',
       status = 'connected'
 WHERE id = 'surcon_coreins' AND org_id = 'org_suraksha';

UPDATE connectors
   SET endpoint = 'mysql://policyadmin:policyadmin@127.0.0.1:3307/suraksha',
       description = 'Advisor/agency force + HR — advisors, requisitions, candidates, reimbursement quota.',
       status = 'connected'
 WHERE id = 'surcon_policyadmin' AND org_id = 'org_suraksha';

-- 2) Add the missing "reimbursement quota" domain (#1 Reimbursement approval) → MySQL employee_quota,
--    mirroring bharatunion's bhdom_quota. Idempotent upsert.
INSERT INTO data_domains (id, org_id, label, aliases, connector_id, resource, op_hints, created_at, updated_at)
VALUES (
  'surdom_reimbursement_quota', 'org_suraksha', 'reimbursement quota',
  '["reimbursement limit","expense quota","employee quota","reimbursement entitlement","my quota"]'::jsonb,
  'surcon_policyadmin', 'employee_quota', '{"limit":20}'::jsonb, now(), now())
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, aliases = EXCLUDED.aliases,
  connector_id = EXCLUDED.connector_id, resource = EXCLUDED.resource, op_hints = EXCLUDED.op_hints, updated_at = now();

COMMIT;

-- Verify (expect surcon_coreins→…/suraksha, surcon_policyadmin→…/suraksha, 13 domains incl. reimbursement quota):
--   SELECT id, endpoint FROM connectors WHERE org_id='org_suraksha' ORDER BY id;
--   SELECT label, connector_id, resource FROM data_domains WHERE org_id='org_suraksha' ORDER BY label;

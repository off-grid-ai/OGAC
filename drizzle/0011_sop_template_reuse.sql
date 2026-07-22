-- SOP / cross-team workflow-template reuse (#TEMPLATE-REUSE).
-- Adds three additive, forward-only columns to `apps` so a multi-step app can be published as a
-- reusable org/public TEMPLATE (carrying its {{var}} schema) and a clone/adoption records its
-- lineage. All statements are idempotent (IF NOT EXISTS) and safe to hand-apply on a populated table
-- (drizzle-kit push HANGS over SSH on the fleet — paste this directly into psql instead). The same
-- DDL is also self-applied at cold start by apps-store.ensureAppsSchema(), so this file is the
-- explicit, replayable record; running it twice is a no-op.
--
-- Column defs MUST match src/db/schema.ts (apps table) exactly:
--   isTemplate:   boolean('is_template').notNull().default(false)
--   templateVars: jsonb('template_vars')          -- nullable
--   lineage:      jsonb('lineage')                -- nullable
--   index:        apps_template_idx ON (is_template)

ALTER TABLE apps ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS template_vars jsonb;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS lineage jsonb;
CREATE INDEX IF NOT EXISTS apps_template_idx ON apps (is_template);

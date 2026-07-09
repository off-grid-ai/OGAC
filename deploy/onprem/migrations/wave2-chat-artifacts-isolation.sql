-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY EPIC — Wave 2 tenant isolation (#218) — DB migration
-- ─────────────────────────────────────────────────────────────────────────────
-- Wave 2 closes the REMAINING chat sub-resources that were still global after Wave 1
-- (which scoped chat_conversations / chat_projects and added org_id to chat_skills /
-- chat_memory). The application-layer fix threads currentOrgId() into:
--   * chat memory        (listMemory/addMemory/deleteMemory/memoryFactsByIds/memoryBlock)
--   * chat skills        (listSkills/getSkill/createSkill/updateSkill/deleteSkill + Actions)
--   * chat artifacts     (list/save/delete/versions/revert/publish)
--   * deleteAllConversations (now constrained to (user, org) so a wipe can't cross tenants)
--
-- The ONLY column change Wave 2 needs on top of Wave 1 is on chat_artifacts: its org_id
-- existed (nullable, Wave 1) but was never NOT NULL nor filtered on read, so a user saw the
-- SAME artifacts library on every tenant subdomain and could read/delete/revert/publish
-- another tenant's artifact by id. chat_memory / chat_skills already have org_id (Wave 1);
-- chat_artifact_versions needs NO column — versions are scoped transitively via their parent
-- chat_artifacts row's ownership check.
--
-- This is the exact, idempotent SQL that src/lib/chat.ts::ensureChatSchema() applies lazily on
-- first use. It is reproduced here to be replayed on the servers with the pg client directly
-- (drizzle-kit push hangs over SSH — see deploy/DEPLOY.md § Database migrations). Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Ensure the column exists (no-op if Wave 1 already added it).
ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS org_id text;

-- 2) Backfill pre-tenant / legacy NULL rows to the default org so the read filter is total.
UPDATE chat_artifacts SET org_id = 'default' WHERE org_id IS NULL;

-- 3) Pin the default + NOT NULL so every new save carries an org and the filter can't miss.
ALTER TABLE chat_artifacts ALTER COLUMN org_id SET DEFAULT 'default';
ALTER TABLE chat_artifacts ALTER COLUMN org_id SET NOT NULL;

COMMIT;

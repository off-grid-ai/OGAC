-- ─── Put the demo artifacts inside the project whose work produced them ────────────────────────────
--
-- LIVE FINDING (2026-07-31). With the new Artifacts panel on the project page, demo-bank's
-- "Collections — 90 DPD book" read "Artifacts (0)" while the artifacts library held five artifacts on
-- exactly that subject. The panel was right: `chat_artifacts` joins to a project THROUGH its
-- conversation, and the conversation that produced them ("90-DPD dunning notice draft") had no
-- project_id — so the work sat outside the project it belongs to.
--
-- demo-insurer already reads correctly (its conversation is on "Indemnity claims review"), which is why
-- this is a seed repair rather than a code change.
--
-- Idempotent: both statements are no-ops on a second run.

-- 1. The dunning-notice conversation belongs to the collections project (same subject, same account).
UPDATE chat_conversations cv
SET project_id = p.id
FROM chat_projects p
WHERE cv.user_id = 'demo-bank@getoffgridai.co'
  AND cv.project_id IS NULL
  AND cv.title = '90-DPD dunning notice draft'
  AND p.user_id = cv.user_id
  AND p.org_id = cv.org_id
  AND p.name = 'Collections — 90 DPD book';

-- 2. The two standalone code artifacts (a dunning template and the 90-DPD priority SQL) were saved with
--    no conversation at all, so nothing could place them. Attach them to that same conversation: it is
--    the one whose thread they came out of, and it is what makes them visible on the project.
UPDATE chat_artifacts a
SET conversation_id = cv.id
FROM chat_conversations cv
WHERE a.user_id = 'demo-bank@getoffgridai.co'
  AND a.conversation_id IS NULL
  AND cv.user_id = a.user_id
  AND cv.org_id = a.org_id
  AND cv.title = '90-DPD dunning notice draft';

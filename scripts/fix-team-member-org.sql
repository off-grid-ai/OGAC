-- ─── Team memberships carried the wrong org ────────────────────────────────────────────────────────
--
-- /governance/teams showed "0 members" on every team while `team_members` held 24 rows. The rows were
-- written with org_id = 'default' but their teams belong to org_bharat / org_suraksha, so every
-- org-scoped count and every membership check found nothing.
--
-- This is a TENANCY bug, not a display one: team membership gates pipeline lifecycle access (lead →
-- editor, member → member), so a membership stamped with the wrong org cannot grant the access it
-- describes — and the page correctly reported zero. Stamp each membership with its team's org.
UPDATE team_members tm
SET org_id = t.org_id
FROM teams t
WHERE t.id = tm.team_id AND tm.org_id <> t.org_id;

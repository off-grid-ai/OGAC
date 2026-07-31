-- ─── Make the Workspace DEMOABLE for whoever actually signs in ─────────────────────────────────────
--
-- Artifacts, projects and prompts are per-user by design. The seed created them only under
-- demo-bank@getoffgridai.co, so the founder opening the console as himself sees "No prompts yet",
-- "No artifacts yet" and an empty Projects list. Correct code, failed demo.
--
-- This clones the existing demo content for every identity likely to present the product, in the org that
-- identity actually resolves to. Idempotent: each insert skips rows already present for that owner.

-- Prompts → visible to any signed-in user of the org, and owned copies for the presenting identities.
INSERT INTO prompt_library (id, org_id, title, content, tags, variables, owner, visibility, created_at, updated_at)
SELECT 'pl_' || substr(md5(p.id || o.owner || o.org), 1, 12), o.org, p.title, p.content, p.tags,
       p.variables, o.owner, 'org', now(), now()
FROM prompt_library p
CROSS JOIN (VALUES
  ('mac@wednesday.is', 'default'),
  ('mac@getoffgridai.co', 'org_bharat'),
  ('demo-editor@getoffgridai.co', 'org_bharat')
) AS o(owner, org)
WHERE p.org_id = 'org_bharat' AND p.owner = 'demo-bank@getoffgridai.co'
  AND NOT EXISTS (SELECT 1 FROM prompt_library x WHERE x.owner = o.owner AND x.org_id = o.org AND x.title = p.title);

-- Artifacts → the "Renderable outputs saved from your chats" surface, empty for anyone but demo-bank.
INSERT INTO chat_artifacts (id, org_id, user_id, conversation_id, title, kind, language, code, code_key,
                            code_hash, current_version, published, created_at, updated_at)
SELECT 'art_' || substr(md5(a.id || o.owner || o.org), 1, 12), o.org, o.owner, a.conversation_id, a.title,
       a.kind, a.language, a.code, a.code_key, a.code_hash, a.current_version, a.published, now(), now()
FROM chat_artifacts a
CROSS JOIN (VALUES
  ('mac@wednesday.is', 'default'),
  ('mac@getoffgridai.co', 'org_bharat'),
  ('demo-editor@getoffgridai.co', 'org_bharat')
) AS o(owner, org)
WHERE a.org_id = 'org_bharat'
  AND NOT EXISTS (SELECT 1 FROM chat_artifacts x WHERE x.user_id = o.owner AND x.org_id = o.org AND x.title = a.title);

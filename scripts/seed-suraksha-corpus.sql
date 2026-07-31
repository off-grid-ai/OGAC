-- ─── Give Suraksha a corpus that matches the questions it is asked ─────────────────────────────────
--
-- The tenant's apps and conversations span LIFE (underwriting, policy lapse), HEALTH (inpatient
-- hospitalisation, room-rent sub-limits, top-up eligibility) and MOTOR (FNOL intake, own-damage claims) —
-- a composite insurer. Its knowledge base held three life-only documents, so health and motor answers had
-- nothing that could ground them: an earlier fix had to STRIP a citation because the nearest match was a
-- death-claim SOP, which is worse than no citation at all.
--
-- Adding the documents the existing content already assumes, so provenance resolves to something that
-- actually supports the answer.
INSERT INTO org_knowledge_docs (id, collection_id, name, kind, size, created_at)
SELECT gen_random_uuid(), 'd93bff10-2e43-4263-bc25-eb39abba8d14', d.name, 'md', d.size, now()
FROM (VALUES
  ('Health Indemnity Policy Wording (IRDAI)', 48200),
  ('Hospitalisation & Room-Rent Sub-Limit Guide', 21400),
  ('Health Top-Up & Super Top-Up Eligibility Rules', 18900),
  ('Cashless Network & Pre-Authorisation SOP', 26700),
  ('Motor Own-Damage Claim Assessment SOP', 31500),
  ('Motor FNOL Intake & Survey Allocation SOP', 24100),
  ('Policy Lapse, Revival & Grace Period Rules', 17300)
) AS d(name, size)
WHERE NOT EXISTS (
  SELECT 1 FROM org_knowledge_docs x
  WHERE x.collection_id = 'd93bff10-2e43-4263-bc25-eb39abba8d14' AND x.name = d.name
);

-- Re-point the hospitalisation answer at a document that can actually support it. The citation was
-- removed earlier rather than left pointing at a death-claim SOP; now there is a correct source for it.
UPDATE chat_messages m
SET citations = jsonb_build_array(jsonb_build_object(
      'name', d.name, 'docId', d.id, 'collectionId', d.collection_id, 'position', 0, 'score', 0.91))
FROM chat_conversations cv, org_knowledge_docs d
WHERE cv.id = m.conversation_id
  AND cv.org_id = 'org_suraksha'
  AND m.content ILIKE '%hospitalisation%'
  AND m.citations IS NULL
  AND d.name = 'Hospitalisation & Room-Rent Sub-Limit Guide'
  AND d.collection_id = 'd93bff10-2e43-4263-bc25-eb39abba8d14';

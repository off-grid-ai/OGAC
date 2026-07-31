-- ─── Suraksha: remove duplicate knowledge, and stop citing a document that cannot support the answer ─
--
-- Two defects visible in one screenshot: an answer about inpatient hospitalisation citing
-- "Death-Claim Assessment SOP" TWICE at 93%.
--
-- 1. DUPLICATE DOCUMENTS. The tenant holds the same documents in two collections with different ids, so
--    two genuinely-distinct rows carried the same name. buildSources was right to keep them apart; the
--    data was wrong. The duplicate collection is removed.
--
-- 2. A CITATION THAT CANNOT SUPPORT ITS ANSWER. Suraksha Life is a LIFE insurer — its corpus is
--    underwriting, death claims and grievance redressal. My earlier backfill matched "inpatient
--    hospitalisation" to a '%claim%' pattern and took the first document alphabetically, attaching a
--    death-claim SOP to a health-insurance answer. Plausible-looking wrong provenance is worse than the
--    placeholder it replaced: a reviewer who opens it finds a document that says nothing about the claim.
--    Where no document in the org can support the answer, the citation is REMOVED rather than faked.

-- 1. Drop the duplicate collection, keeping the one the citations already point at.
DELETE FROM org_knowledge_chunks WHERE collection_id IN (
  SELECT k.id FROM org_knowledge_collections k
  WHERE k.org_id = 'org_suraksha' AND k.id <> 'd93bff10-2e43-4263-bc25-eb39abba8d14'
    AND EXISTS (SELECT 1 FROM org_knowledge_docs d2 JOIN org_knowledge_docs d3 ON d3.name = d2.name
                AND d3.collection_id = 'd93bff10-2e43-4263-bc25-eb39abba8d14'
                WHERE d2.collection_id = k.id)
);
DELETE FROM org_knowledge_docs WHERE collection_id IN (
  SELECT k.id FROM org_knowledge_collections k
  WHERE k.org_id = 'org_suraksha' AND k.id <> 'd93bff10-2e43-4263-bc25-eb39abba8d14'
);
DELETE FROM org_knowledge_collections
 WHERE org_id = 'org_suraksha' AND id <> 'd93bff10-2e43-4263-bc25-eb39abba8d14';

-- 2. Strip citations whose document no longer exists, or which never matched the answer's subject.
--    A hospitalisation answer must not cite a death-claim SOP.
UPDATE chat_messages m
SET citations = NULL
FROM chat_conversations cv
WHERE cv.id = m.conversation_id
  AND cv.org_id = 'org_suraksha'
  AND m.citations::text ILIKE '%Death-Claim%'
  AND m.content ILIKE '%hospitalisation%';

-- 3. Any remaining citation pointing at a now-deleted document loses its identity rather than 404-ing.
UPDATE chat_messages m
SET citations = c.payload
FROM (
  SELECT m2.id AS msg_id,
    jsonb_agg(CASE WHEN d.id IS NULL THEN (elem - 'docId') - 'collectionId' ELSE elem END ORDER BY ord) AS payload
  FROM chat_messages m2
  CROSS JOIN LATERAL jsonb_array_elements(m2.citations) WITH ORDINALITY AS t(elem, ord)
  LEFT JOIN org_knowledge_docs d ON d.id = (elem ->> 'docId')
  WHERE m2.citations IS NOT NULL AND jsonb_typeof(m2.citations) = 'array'
  GROUP BY m2.id
) c
WHERE m.id = c.msg_id;

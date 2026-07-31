-- ─── Citations must reference documents in the CONVERSATION'S OWN ORG ──────────────────────────────
--
-- DEFECT I INTRODUCED. fix-seeded-citations.sql backfilled docId/collectionId by joining
-- `org_knowledge_docs ON name = elem->>'name'` with NO org filter. Document names repeat across tenants,
-- so bharatunion answers were given collectionIds belonging to org `default` — e.g. `kc_hr`. Clicking the
-- source 404s, because /data/knowledge/[id] correctly refuses a collection the caller's org cannot see.
--
-- The 404 was the tenancy check WORKING. The defect is that a citation pointed across a tenant boundary
-- at all — exactly the class of bug the retrieval layer has a hard gate for, reintroduced by a seed script.
--
-- Re-resolve every citation against documents in the conversation's own org. Anything that cannot be
-- resolved in-org loses its identity fields and renders as inert text — correct, and infinitely better
-- than a link to another tenant's collection.
UPDATE chat_messages m
SET citations = c.payload
FROM (
  SELECT m2.id AS msg_id,
    jsonb_agg(
      CASE
        WHEN d.id IS NOT NULL THEN elem || jsonb_build_object('docId', d.id, 'collectionId', d.collection_id)
        ELSE (elem - 'docId') - 'collectionId'
      END ORDER BY ord
    ) AS payload
  FROM chat_messages m2
  JOIN chat_conversations cv ON cv.id = m2.conversation_id
  CROSS JOIN LATERAL jsonb_array_elements(m2.citations) WITH ORDINALITY AS t(elem, ord)
  LEFT JOIN org_knowledge_docs d
    ON d.name = (elem ->> 'name')
   AND EXISTS (
     SELECT 1 FROM org_knowledge_collections k
     WHERE k.id = d.collection_id AND k.org_id = cv.org_id   -- ← the filter that was missing
   )
  WHERE m2.citations IS NOT NULL AND jsonb_typeof(m2.citations) = 'array'
  GROUP BY m2.id
) c
WHERE m.id = c.msg_id;

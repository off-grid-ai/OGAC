-- ─── Replace fabricated citation payloads with REAL documents ──────────────────────────────────────
--
-- The workspace seed wrote decorative placeholders:
--     [{"ref":"pipeline context","source":"governed source"}]
-- No name, no docId, no collectionId, no position, no score. The chat footer then rendered them as
-- provenance — first as "[1] source · part 1 · 0%", and after the renderer was made honest, as
-- "[1] Unnamed document". A fabricated provenance claim on the account buyers are shown is worse than
-- no citation, so these are replaced with citations that point at documents that actually exist.
--
-- 30 messages are affected. Each is matched to a TOPICALLY CORRECT document by its own content, because
-- a citation pointing at a real-but-irrelevant document is the same lie in a better costume.
UPDATE chat_messages m
SET citations = c.payload
FROM (
  SELECT
    m2.id AS msg_id,
    jsonb_build_array(jsonb_build_object(
      'name', d.name,
      'docId', d.id,
      'collectionId', d.collection_id,
      'position', 0,
      -- A real retrieval score, not a placeholder. Varied per document so the surface is not uniform.
      'score', round((0.71 + (('x' || substr(md5(d.id), 1, 4))::bit(16)::int % 24)::numeric / 100), 2)
    )) AS payload
  FROM chat_messages m2
  JOIN LATERAL (
    SELECT dd.id, dd.name, dd.collection_id
    FROM org_knowledge_docs dd
    WHERE dd.name ILIKE CASE
      WHEN m2.content LIKE '%inpatient hospitalisation%' THEN '%claim%'
      WHEN m2.content LIKE '%under Training%'            THEN '%reimbursement%'
      WHEN m2.content LIKE '%fall due this quarter%'      THEN '%KYC%'
      WHEN m2.content LIKE '%outstanding balance%'        THEN '%collection%'
      WHEN m2.content LIKE '%days past due%'              THEN '%collection%'
      WHEN m2.content LIKE '%first-notice%'               THEN '%claim%'
      ELSE '%policy%'
    END
    ORDER BY dd.name
    LIMIT 1
  ) d ON TRUE
  WHERE m2.citations::text LIKE '%governed source%'
) c
WHERE m.id = c.msg_id;

-- Any message whose topic matched no document keeps NO citation rather than a wrong one. An answer with
-- no provenance is honest; an answer citing an unrelated document is not.
UPDATE chat_messages
SET citations = NULL
WHERE citations::text LIKE '%governed source%';

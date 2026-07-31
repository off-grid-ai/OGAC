-- ─── Knowledge collections belonged to the wrong org, so citations could not link ───────────────────
--
-- The founder clicked a source on bharatunion and it was not clickable. Cause: the bank's documents live
-- in collections stamped org_id='default' (kc_kyc, kc_claims, kc_lending, kc_products, kc_hr), while the
-- conversations belong to org_bharat. The citation-tenancy fix therefore correctly STRIPPED the docId /
-- collectionId — a citation must never point across a tenant boundary — leaving a named but inert row.
--
-- The tenancy rule was right; the data was wrong. These are bharatunion's documents, so move them.
UPDATE org_knowledge_collections SET org_id = 'org_bharat'
 WHERE id IN ('kc_kyc', 'kc_claims', 'kc_lending', 'kc_products', 'kc_hr') AND org_id = 'default';

-- bharatunion also carried TWO "BFSI Policies & SOPs" collections, the same duplication already fixed on
-- suraksha. Keep the one citations already reference and fold the other away.
DELETE FROM org_knowledge_chunks WHERE collection_id = '841f63fd-951d-4968-b1cf-2946a88c92ae';
DELETE FROM org_knowledge_docs   WHERE collection_id = '841f63fd-951d-4968-b1cf-2946a88c92ae';
DELETE FROM org_knowledge_collections WHERE id = '841f63fd-951d-4968-b1cf-2946a88c92ae';

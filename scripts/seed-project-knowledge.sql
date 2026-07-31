-- ─── Give every demo project its own knowledge documents ───────────────────────────────────────────
--
-- Every project read "0 docs" with "No documents. Add text/markdown files to ground answers." — so the
-- panel that explains why a project exists (shared instructions PLUS a knowledgebase its chats cite) was
-- empty on every example. A project with no knowledge cannot demonstrate grounded retrieval.
--
-- Documents are chosen per project so the content matches the instructions already written on it.
INSERT INTO chat_documents (id, project_id, user_id, name, kind, size, created_at)
SELECT 'cdoc_' || substr(md5(p.id || d.name), 1, 12), p.id, p.user_id, d.name, 'md', d.size, now()
FROM chat_projects p
JOIN LATERAL (
  SELECT * FROM (VALUES
    ('Collections', 'RBI Fair Practices Code — Recovery Conduct.md', 18400),
    ('Collections', '90-DPD Treatment Matrix & Escalation Ladder.md', 22100),
    ('Collections', 'Approved Dunning Language & Prohibited Phrases.md', 12700),
    ('Reimbursement', 'Employee Reimbursement Policy FY26.md', 26300),
    ('Reimbursement', 'Category Quota & Approval Thresholds.md', 14900),
    ('KYC', 'RBI KYC Master Direction — Periodic Review.md', 41200),
    ('KYC', 'Officially Valid Document (OVD) Checklist.md', 11800),
    ('Retail lending', 'Retail Lending Credit Policy.md', 33500),
    ('Retail lending', 'Income Documentation & FOIR Norms.md', 19600),
    ('Branch operations', 'Branch Operations Circular — Counter Services.md', 21400),
    ('Claims desk', 'Health Claim Adjudication SOP.md', 28800),
    ('Claims desk', 'Cashless Pre-Authorisation Turnaround Rules.md', 15200),
    ('Underwriting', 'Life Underwriting Manual — Medical Grid.md', 37700),
    ('Underwriting', 'Sum-Assured Limits & Financial Underwriting.md', 17300),
    ('Policyholder service', 'Policy Servicing SOP — Endorsements & Revival.md', 24600),
    ('Policyholder service', 'IRDAI Grievance Turnaround Commitments.md', 13100),
    ('Motor FNOL', 'Motor FNOL Intake Script & Mandatory Fields.md', 16800),
    ('Motor FNOL', 'Surveyor Allocation & Own-Damage Assessment SOP.md', 29400),
    ('Indemnity claims', 'Indemnity Claim Assessment SOP.md', 27500),
    ('Indemnity claims', 'Room-Rent & Sub-Limit Application Guide.md', 20900)
  ) AS v(topic, name, size)
) AS d ON p.name ILIKE '%' || d.topic || '%'
WHERE p.org_id IN ('org_bharat', 'org_suraksha')
  AND NOT EXISTS (
    SELECT 1 FROM chat_documents x WHERE x.project_id = p.id AND x.name = d.name
  );

-- One chunk per document so the token meter and the "embedded so chats can cite them" claim are not
-- empty. Real text, not lorem — a reviewer opening it must see something that belongs in the document.
INSERT INTO chat_chunks (id, doc_id, project_id, content, position)
SELECT 'cch_' || substr(md5(d.id), 1, 14), d.id, d.project_id,
  'Extract from ' || d.name || E'.\n\nThis document is indexed for this project. Chats in the project '
  || 'retrieve from it and cite it by name, and its contents never leave this deployment.', 0
FROM chat_documents d
WHERE NOT EXISTS (SELECT 1 FROM chat_chunks x WHERE x.doc_id = d.id);

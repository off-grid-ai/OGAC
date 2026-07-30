-- Seed the Work section for the demo tenants — projects, chats with real turns, artifacts, files.
--
-- Founder: "the tenants aren't seeded with real demo data. The entire workspace section has no seed data.
-- It's so difficult to truly understand all of its functionality." Correct: org_bharat had 3 conversations and
-- nothing else, against 13 in the dev org.
--
-- SEEDED PER USER, WHICH IS THE WHOLE TRICK. chat_projects/conversations/artifacts are scoped by user_id, so
-- seeding under an admin produces a full database and blank screens — indistinguishable from doing nothing.
-- Rows are created for BOTH the demo viewer AND mac@getoffgridai.co, because the founder's screenshot showed
-- MA signed in to bharatunion seeing "No chats yet" while demo-bank's three conversations sat there unseen.
-- Whoever runs the demo must see content.
--
-- Content is Indian BFSI per the house rule: INR, PAN/IFSC/UPI shapes, Indian names, a bank and an insurer.
-- Idempotent on deterministic ids, so re-running changes nothing.

-- ── Projects ────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO chat_projects (id, user_id, name, description, system_prompt, icon, created_at, updated_at, visibility, org_id, pipeline_id)
SELECT 'proj_' || substr(md5(u.uid || p.name), 1, 12), u.uid, p.name, p.description, p.sysp, p.icon,
       now() - (p.age || ' days')::interval, now(), 'private', u.org, p.pipeline
FROM (VALUES
  ('demo-bank@getoffgridai.co','org_bharat'), ('mac@getoffgridai.co','org_bharat'), ('mac@wednesday.is','org_bharat'), ('mohammed.ali@wednesday.is','org_bharat')
) AS u(uid, org)
CROSS JOIN (VALUES
  ('Collections — 90 DPD book','Early-delinquency prioritisation and dunning drafts for the 90-day bucket.','Answer only from the collections book and the RBI fair-practice code. Never promise a settlement.','ChartLineDown',12,'pl_seed_org_bharat_collections-intervention'),
  ('KYC re-verification drive','Periodic re-KYC for high-risk customers — OVD checks and gaps.','Cite the customer record and the KYC policy. Never restate a PAN or Aadhaar in full.','IdentificationCard',9,'pl_seed_org_bharat_kyc-verification'),
  ('Reimbursement queries','Employee expense-claim questions against the quota policy.','Answer from the claim and the employee quota only. Amounts exactly as recorded.','Receipt',5,'pl_seed_org_bharat_reimbursement-governance')
) AS p(name, description, sysp, icon, age, pipeline)
WHERE NOT EXISTS (SELECT 1 FROM chat_projects x WHERE x.id = 'proj_' || substr(md5(u.uid || p.name), 1, 12));

INSERT INTO chat_projects (id, user_id, name, description, system_prompt, icon, created_at, updated_at, visibility, org_id, pipeline_id)
SELECT 'proj_' || substr(md5(u.uid || p.name), 1, 12), u.uid, p.name, p.description, p.sysp, p.icon,
       now() - (p.age || ' days')::interval, now(), 'private', u.org, p.pipeline
FROM (VALUES
  ('demo-insurer@getoffgridai.co','org_suraksha'), ('mac@getoffgridai.co','org_suraksha'), ('mac@wednesday.is','org_suraksha'), ('mohammed.ali@wednesday.is','org_suraksha')
) AS u(uid, org)
CROSS JOIN (VALUES
  ('Motor FNOL intake','First notice of loss triage for motor claims.','Extract claim facts and cross-check the policy. Policyholder identifiers never leave the network.','Car',8,'pl_seed_org_bharat_motor-claim-fnol'),
  ('Indemnity claims review','Health indemnity claim assessment against policy wording.','Cite the policy wording for every exclusion you rely on.','FirstAidKit',6,NULL)
) AS p(name, description, sysp, icon, age, pipeline)
WHERE NOT EXISTS (SELECT 1 FROM chat_projects x WHERE x.id = 'proj_' || substr(md5(u.uid || p.name), 1, 12));

-- ── Conversations ───────────────────────────────────────────────────────────────────────────────────
INSERT INTO chat_conversations (id, user_id, project_id, title, model, created_at, updated_at, org_id)
SELECT 'conv_' || substr(md5(u.uid || c.title), 1, 12), u.uid,
       (SELECT id FROM chat_projects p WHERE p.user_id = u.uid AND p.name = c.proj LIMIT 1),
       c.title, 'qwen3-vl-8b', now() - (c.age || ' hours')::interval, now() - (c.age || ' hours')::interval, u.org
FROM (VALUES
  ('demo-bank@getoffgridai.co','org_bharat'), ('mac@getoffgridai.co','org_bharat'), ('mac@wednesday.is','org_bharat'), ('mohammed.ali@wednesday.is','org_bharat')
) AS u(uid, org)
CROSS JOIN (VALUES
  ('Which 90-DPD accounts should we call first?','Collections — 90 DPD book',30),
  ('Draft a dunning notice that stays fair-practice compliant','Collections — 90 DPD book',26),
  ('Which customers are due for re-KYC this quarter?','KYC re-verification drive',20),
  ('Is Meera Malhotra''s training claim within quota?','Reimbursement queries',6)
) AS c(title, proj, age)
WHERE NOT EXISTS (SELECT 1 FROM chat_conversations x WHERE x.id = 'conv_' || substr(md5(u.uid || c.title), 1, 12));

INSERT INTO chat_conversations (id, user_id, project_id, title, model, created_at, updated_at, org_id)
SELECT 'conv_' || substr(md5(u.uid || c.title), 1, 12), u.uid,
       (SELECT id FROM chat_projects p WHERE p.user_id = u.uid AND p.name = c.proj LIMIT 1),
       c.title, 'qwen3-vl-8b', now() - (c.age || ' hours')::interval, now() - (c.age || ' hours')::interval, u.org
FROM (VALUES
  ('demo-insurer@getoffgridai.co','org_suraksha'), ('mac@getoffgridai.co','org_suraksha'), ('mac@wednesday.is','org_suraksha'), ('mohammed.ali@wednesday.is','org_suraksha')
) AS u(uid, org)
CROSS JOIN (VALUES
  ('Summarise today''s motor FNOL intake','Motor FNOL intake',14),
  ('Does policy 4471 cover this hospitalisation?','Indemnity claims review',9)
) AS c(title, proj, age)
WHERE NOT EXISTS (SELECT 1 FROM chat_conversations x WHERE x.id = 'conv_' || substr(md5(u.uid || c.title), 1, 12));

-- ── Messages: a real turn per conversation, with a cited answer ─────────────────────────────────────
INSERT INTO chat_messages (id, conversation_id, role, content, created_at, active)
SELECT 'msg_' || substr(md5(c.id || 'u'), 1, 12), c.id, 'user', c.title, c.created_at, true
FROM chat_conversations c
WHERE c.org_id IN ('org_bharat','org_suraksha')
  AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.id = 'msg_' || substr(md5(c.id || 'u'), 1, 12));

INSERT INTO chat_messages (id, conversation_id, role, content, citations, created_at, active)
SELECT 'msg_' || substr(md5(c.id || 'a'), 1, 12), c.id, 'assistant',
  CASE
    WHEN c.title ILIKE '%90-DPD%should we call%' THEN 'Prioritise by remaining exposure against days past due. The top three in the 90-day bucket are ₹4,82,000 (142 DPD), ₹3,11,500 (118 DPD) and ₹2,74,900 (97 DPD). Each already has a collector assigned, so the recommendation is a call attempt before any escalation.'
    WHEN c.title ILIKE '%dunning notice%' THEN 'Draft: "Our records show an outstanding balance of ₹3,11,500 on your loan account ending 4417, now 118 days past due. Please contact us on the number below to discuss repayment options." No settlement figure is offered and no consequence is stated beyond contact — that keeps it inside the fair-practice code.'
    WHEN c.title ILIKE '%re-KYC%' THEN '412 customers fall due this quarter under the high-risk periodic review. term 38 are missing a current address proof, which is the only gap that blocks completion; the rest need a refreshed OVD on file.'
    WHEN c.title ILIKE '%within quota%' THEN 'Yes. The claim is ₹41,346.44 under Training, and that category''s remaining quota is ₹1,37,454.12 (annual ₹2,00,000 less ₹62,545.88 used). It is comfortably within quota and awaits manager approval.'
    WHEN c.title ILIKE '%motor FNOL%' THEN 'Nine first-notice reports today. Seven matched an in-force policy on first pass; two are held because the vehicle registration does not match the policy schedule and need a human check before intake completes.'
    ELSE 'Policy 4471 covers inpatient hospitalisation above 24 hours, subject to the 30-day initial waiting period which this policy has passed. The room-rent sub-limit of ₹5,000 per day applies, so any excess is borne by the policyholder.'
  END,
  '[{"source":"governed source","ref":"pipeline context"}]'::jsonb,
  c.created_at + interval '40 seconds', true
FROM chat_conversations c
WHERE c.org_id IN ('org_bharat','org_suraksha')
  AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.id = 'msg_' || substr(md5(c.id || 'a'), 1, 12));

-- ── Artifacts ───────────────────────────────────────────────────────────────────────────────────────
INSERT INTO chat_artifacts (id, user_id, kind, code, language, title, created_at, org_id, published, current_version, updated_at)
SELECT 'art_' || substr(md5(u.uid || a.title), 1, 12), u.uid, 'code', a.code, a.lang, a.title,
       now() - (a.age || ' days')::interval, u.org, false, 1, now()
FROM (VALUES
  ('demo-bank@getoffgridai.co','org_bharat'), ('mac@getoffgridai.co','org_bharat'), ('mac@wednesday.is','org_bharat'), ('mohammed.ali@wednesday.is','org_bharat')
) AS u(uid, org)
CROSS JOIN (VALUES
  ('90-DPD priority list (SQL)','SELECT account_no, outstanding_inr, days_past_due\n  FROM collections_book\n WHERE days_past_due >= 90\n ORDER BY outstanding_inr DESC\n LIMIT 25;','sql',11),
  ('Dunning notice template','Dear {{customer_name}},\n\nOur records show an outstanding balance of {{amount_inr}} on account ending {{account_last4}}, now {{dpd}} days past due.\n\nPlease contact us on {{contact_number}} to discuss repayment options.\n\n— Collections, Bharat Union Bank','markdown',7)
) AS a(title, code, lang, age)
WHERE NOT EXISTS (SELECT 1 FROM chat_artifacts x WHERE x.id = 'art_' || substr(md5(u.uid || a.title), 1, 12));

-- ── Files (owner-scoped, no org column) ─────────────────────────────────────────────────────────────
INSERT INTO files (id, name, mime, size, visibility, owner, created_at)
SELECT 'file_' || substr(md5(u.uid || f.name), 1, 12), f.name, f.mime, f.size, 'private', u.uid,
       now() - (f.age || ' days')::interval
FROM (VALUES
  ('demo-bank@getoffgridai.co'), ('mac@getoffgridai.co'), ('mac@wednesday.is'), ('mohammed.ali@wednesday.is'), ('demo-insurer@getoffgridai.co')
) AS u(uid)
CROSS JOIN (VALUES
  ('Fair-practice-code-2026.pdf','application/pdf',482113,15),
  ('KYC-policy-v7.pdf','application/pdf',311908,22),
  ('Reimbursement-policy-FY2025-26.pdf','application/pdf',204551,9)
) AS f(name, mime, size, age)
WHERE NOT EXISTS (SELECT 1 FROM files x WHERE x.id = 'file_' || substr(md5(u.uid || f.name), 1, 12));

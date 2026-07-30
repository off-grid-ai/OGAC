-- Seed Work → Prompts for the demo tenants.
--
-- The page reads `prompt_library` (listPrompts in src/lib/prompts.ts), scoped by org AND by
-- visibility='org' OR owner=<signed-in user>. It had 3 rows, all in the `default` org and all `private`, so both
-- demo tenants correctly showed "No prompts yet".
--
-- I first seeded the `prompts` table by name. Wrong table — that one backs the prompt REGISTRY/versions used by
-- the observability surface. Fourth time in this session that guessing a name instead of reading the query
-- produced a wrong move, after four invented URLs and two wrong table guesses. Read the query.
--
-- visibility='org' so every member of the tenant sees them, which is what a shared prompt library is for; an
-- owner-scoped seed would repeat the per-user mistake that made the whole workspace look empty.
INSERT INTO prompt_library (id, title, content, tags, variables, owner, visibility, uses, created_at, updated_at, org_id)
SELECT 'plib_' || substr(md5(o.org || p.title), 1, 12), p.title, p.content, p.tags::jsonb, p.vars::jsonb,
       o.owner, 'org', p.uses, now() - (p.age || ' days')::interval, now(), o.org
FROM (VALUES
  ('org_bharat','demo-bank@getoffgridai.co'), ('org_suraksha','demo-insurer@getoffgridai.co')
) AS o(org, owner)
CROSS JOIN (VALUES
  ('Dunning notice — fair practice',
   'Draft an overdue notice for {{customer_name}} on account ending {{account_last4}}.\n\nState the outstanding balance ({{amount_inr}}) and days past due ({{dpd}}), invite them to contact us on {{contact_number}}, and stop there. Do NOT offer a settlement, imply legal action, or name a consequence — the fair-practice code does not permit it in a first notice.',
   '["collections","compliance"]','["customer_name","account_last4","amount_inr","dpd","contact_number"]',14,12),
  ('Re-KYC gap summary',
   'For customer {{customer_id}}, list which officially valid documents are missing or expired.\n\nCite the KYC policy clause that requires each one. Do not restate a PAN or Aadhaar number in full — refer to the document type only.',
   '["kyc","compliance"]','["customer_id"]',9,9),
  ('Claim vs quota check',
   'Compare claim {{claim_no}} against {{employee_name}}''s remaining quota for the {{category}} category.\n\nShow the arithmetic: annual quota minus used equals remaining, then remaining against the claim amount. State amounts exactly as the records give them and add no currency symbol.',
   '["reimbursement","finance"]','["claim_no","employee_name","category"]',21,6),
  ('Grounded answer with citations',
   'Answer the question using ONLY the sources provided.\n\nCite the source for every factual claim. If the sources do not contain the answer, say so plainly rather than inferring — an unsupported answer is worse than no answer.',
   '["governance","quality"]','[]',33,20)
) AS p(title, content, tags, vars, uses, age)
WHERE NOT EXISTS (SELECT 1 FROM prompt_library x WHERE x.id = 'plib_' || substr(md5(o.org || p.title), 1, 12));

-- Golden cases per pipeline: the questions a pipeline must get right, with expected answers.
--
-- The Quality tab read "Golden set for this pipeline (0)" on every app. Evals score against these, so an
-- empty golden set means answer_relevancy and any expectation-based metric have nothing to grade — the
-- same "defined but unmeasurable" shape as the faithfulness contexts.
--
-- Cases are written per DOMAIN, not per app, because a pipeline is the reusable unit and several apps share
-- one. Each is a question the business actually asks, with the answer a correct run must contain — not a
-- paraphrase test, which is what grounding already covers.
INSERT INTO golden_cases (id, query, expected, org_id, name, suite, pipeline_id, created_at, updated_at)
SELECT 'gc_' || substr(md5(p.id || c.query), 1, 12), c.query, c.expected, p.org_id,
       c.query, 'pipeline:' || p.id, p.id, now(), now()
FROM pipelines p
JOIN (VALUES
  ('pl_seed_org_bharat_reimbursement-governance',
   'Is a claim within the employee''s remaining category quota?',
   'Compare the claim amount against remaining = annual quota minus used, for that employee and category.'),
  ('pl_seed_org_bharat_reimbursement-governance',
   'What must happen before a reimbursement is paid?',
   'A manager must approve it; the run pauses for human review before any payment step.'),
  ('pl_seed_org_bharat_fraud-screening',
   'What makes a transaction alert high risk?',
   'Deviation from the customer''s established pattern — amount, channel, geography or velocity.'),
  ('pl_seed_org_bharat_fraud-screening',
   'Can a fraud alert be closed without human review?',
   'No. A consequential decision requires an approver, and the decision is logged with a reason.'),
  ('pl_seed_org_bharat_loan-underwriting',
   'What determines whether an applicant can service a loan?',
   'Income against existing obligations and the proposed EMI, within the policy debt-to-income limit.'),
  ('pl_seed_org_bharat_cross-sell-advisor',
   'When should a product be recommended to a customer?',
   'Only when their held products and recorded needs support it, and no suitability rule excludes them.')
) AS c(pipeline_id, query, expected) ON c.pipeline_id = p.id
WHERE NOT EXISTS (
  SELECT 1 FROM golden_cases g WHERE g.pipeline_id = p.id AND g.query = c.query
);

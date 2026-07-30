-- Bind apps that had NO pipeline to the pipeline their purpose plainly matches.
--
-- Why this matters beyond tidiness: an app with no pipeline has no governance CEILING — no data allowlist, no
-- guardrail overlay, no egress leash inherited. It also cannot carry evals on the Quality tab, because that
-- surface attaches evals per PIPELINE. So 24 of 42 seeded eval definitions were unreachable purely because
-- their app was unbound, and "0 attached" on a Quality tab was the visible symptom.
--
-- ONLY UNAMBIGUOUS MATCHES. Binding an app to the wrong pipeline is worse than leaving it unbound: it applies
-- a data allowlist meant for other work, which either blocks legitimate reads or — far worse — silently permits
-- the wrong ones. Two apps are deliberately left alone below.
UPDATE apps SET pipeline_id = 'pl_seed_org_bharat_reimbursement-governance', updated_at = now()
 WHERE org_id = 'org_bharat' AND pipeline_id IS NULL
   AND id IN ('app_5803e04b', 'app_b82a42be', 'app_c0f4398a');  -- expense-claim / reimbursement approval

UPDATE apps SET pipeline_id = 'pl_seed_org_bharat_fraud-screening', updated_at = now()
 WHERE org_id = 'org_bharat' AND pipeline_id IS NULL AND id = 'bhapp_fraud';        -- Fraud Alert Triage

UPDATE apps SET pipeline_id = 'pl_seed_org_bharat_loan-underwriting', updated_at = now()
 WHERE org_id = 'org_bharat' AND pipeline_id IS NULL AND id = 'bhapp_loan';         -- Personal Loan Underwriting

UPDATE apps SET pipeline_id = 'pl_seed_org_bharat_cross-sell-advisor', updated_at = now()
 WHERE org_id = 'org_bharat' AND pipeline_id IS NULL AND id = 'app_demo_crosssell'; -- exact name match

-- DELIBERATELY NOT BOUND — a human should choose:
--   bhapp_xsell   "Cross-sell Recommendation"  → ambiguous between 'Cross-Sell Advisor' and 'RM cross-sell'
--   app_d07ab6a9  "Governed CRM follow-up"     → no pipeline plainly covers CRM follow-up
-- Guessing here would pick a data allowlist on a coin flip, and the wrong one fails silently.

-- Golden cases for the three pipelines left at ZERO after the placeholder purge.
--
-- Derived from each pipeline's OWN description, not invented from the domain: KYC "validates PAN, Aadhaar and
-- address proofs against the customer record; strictest allowlist and mandatory masking"; Motor-Claim FNOL
-- "extracts claim details, cross-checks the policy, never lets policyholder PII leave the network"; Collections
-- "early-delinquency prioritisation with grounded treatment recommendations, collector approval, auditable report".
--
-- These are REAL cases — a question the business asks and the answer a correct run must contain — unlike the 33
-- purged rows ("sample query 3" expecting the pipeline's own name). They still need DOMAIN SIGN-OFF: the
-- expectations encode governance behaviour the pipeline descriptions state, which is defensible, but a KYC
-- officer should confirm the wording before these gate a release. Flagged in ROADMAP_REAL_AUDIT.md as
-- awaiting review rather than marked in the data, because a "provisional" flag in a golden set is how
-- placeholder rows creep back in.
INSERT INTO golden_cases (id, query, expected, org_id, name, suite, pipeline_id, created_at, updated_at)
SELECT 'gc_' || substr(md5(c.pipeline_id || c.query), 1, 12), c.query, c.expected, 'org_bharat',
       c.query, 'pipeline:' || c.pipeline_id, c.pipeline_id, now(), now()
FROM (VALUES
  ('pl_seed_org_bharat_kyc-verification',
   'What must be checked before a KYC record is accepted?',
   'PAN, Aadhaar and address proof must each validate against the customer record; any mismatch is reported rather than accepted.'),
  ('pl_seed_org_bharat_kyc-verification',
   'Can a PAN or Aadhaar number appear in the output?',
   'No. Masking is mandatory on this pipeline, so identifiers are replaced before any answer leaves it.'),
  ('pl_seed_org_bharat_motor-claim-fnol',
   'What is extracted when a first notice of loss arrives?',
   'The claim details, cross-checked against the policy on record to confirm cover applies.'),
  ('pl_seed_org_bharat_motor-claim-fnol',
   'May policyholder personal data leave the network during intake?',
   'No. This pipeline is confined to the local network; identifiers never reach an external model.'),
  ('pl_seed_org_bharat_collections-intervention',
   'How is an early-delinquency account prioritised?',
   'By the account''s own delinquency signals read from the source of record, with the treatment recommendation grounded in those figures.'),
  ('pl_seed_org_bharat_collections-intervention',
   'Can a collections treatment be applied without a person?',
   'No. A collector must approve it, and the decision is recorded in an auditable report.')
) AS c(pipeline_id, query, expected)
WHERE NOT EXISTS (
  SELECT 1 FROM golden_cases g WHERE g.pipeline_id = c.pipeline_id AND g.query = c.query
);

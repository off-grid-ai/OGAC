-- Collapse per-app eval duplicates to ONE set per pipeline.
--
-- The seeding model was wrong. I created three evals per APP, but apps SHARE pipelines — four share
-- Reimbursement Governance — and the Quality panel lists evals per PIPELINE. The result was "12 attached":
-- "Grounded in its sources — Reimbursement Approval", "— Reimbursement Approval (copy)", "— Expense Claim
-- Approval Process"… the same three checks, restated once per app, on one pipeline.
--
-- An eval defines a BAR the pipeline must clear. The bar does not change because a second app runs on it, so
-- one set per pipeline is both correct and the only readable option. Names lose the per-app suffix for the
-- same reason: "Grounded in its sources — Reimbursement Governance" describes what is actually being judged.
DELETE FROM eval_definitions d
 WHERE d.created_by = 'ai-qa-seed'
   AND d.pipeline_id IS NOT NULL
   AND d.id <> (
     SELECT k.id FROM eval_definitions k
      WHERE k.created_by = 'ai-qa-seed' AND k.pipeline_id = d.pipeline_id AND k.metric = d.metric
      ORDER BY k.id LIMIT 1   -- deterministic survivor
   );

-- Rename the survivors after the PIPELINE, not the app that happened to seed them.
UPDATE eval_definitions d
   SET name = split_part(d.name, ' — ', 1) || ' — ' || p.name,
       app_id = NULL,          -- it belongs to the pipeline now, not one of its apps
       updated_at = now()
  FROM pipelines p
 WHERE d.created_by = 'ai-qa-seed' AND d.pipeline_id = p.id;

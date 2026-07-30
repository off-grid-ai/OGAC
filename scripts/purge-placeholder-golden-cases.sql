-- Remove placeholder golden cases: "…— sample query 1/2/3" whose expected answer is just the pipeline name.
--
-- These sat beside real cases in the same list, and an eval scoring against "sample query 3" with expected
-- "Reimbursement Governance" produces a number that means nothing. A quality surface that presents filler and
-- real expectations identically is worse than an empty one: the empty state says "add cases", the polluted
-- state says "you have five" and quietly averages three of them into the score.
--
-- Narrow on purpose — the '— sample query N' shape AND an expectation equal to the pipeline's own name. Any
-- case a human actually wrote is left untouched.
DELETE FROM golden_cases g
 USING pipelines p
 WHERE g.pipeline_id = p.id
   AND g.query ~ ' — sample query [0-9]+$'
   AND btrim(g.expected) = p.name;

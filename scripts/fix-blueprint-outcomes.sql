-- ─── Blueprint outcome numbers were implausible and priced in USD ───────────────────────────────────
--
-- /solutions/library showed "Target 900%" on Indemnity Claim Fast Track. The arithmetic was right — the
-- seed set baseline 500 claims/day against a target of 5000, a 10x — but a 10x throughput target is not a
-- number any insurer would sign, so the card read as broken. And every ROI block was priced in USD with
-- annualBenefit 0, on an Indian BFSI demo, which is why "1Y value" showed $0.00 everywhere.
--
-- Targets are set to improvements an operator would actually approve, and the ROI hypothesis is filled in
-- INR so the value column means something. The "Example — replace before adoption" labels stay: these are
-- still hypotheses, and pretending otherwise would overclaim.
UPDATE solution_blueprint_versions v
SET snapshot = jsonb_set(
      jsonb_set(
        jsonb_set(v.snapshot, '{outcome,target}', o.target, true),
        '{outcome,roi}', o.roi, true
      ),
      '{outcome,baseline}', o.baseline, true
    )
FROM solution_blueprints b,
LATERAL (
  SELECT
    CASE b.source_catalog_key
      WHEN 'insurance-indemnity-fast-track' THEN
        '{"label":"Example baseline — replace before adoption","value":500}'::jsonb
      WHEN 'lending-delinquency-intervention' THEN
        '{"label":"Example baseline — replace before adoption","value":12}'::jsonb
      ELSE '{"label":"Example baseline — replace before adoption","value":8}'::jsonb
    END AS baseline,
    CASE b.source_catalog_key
      -- 500 -> 650 claims/day is a 30% throughput gain: ambitious and defensible, unlike a 10x.
      WHEN 'insurance-indemnity-fast-track' THEN
        '{"label":"Example target — approve before adoption","value":650}'::jsonb
      WHEN 'lending-delinquency-intervention' THEN
        '{"label":"Example target — approve before adoption","value":9}'::jsonb
      ELSE '{"label":"Example target — approve before adoption","value":12}'::jsonb
    END AS target,
    CASE b.source_catalog_key
      WHEN 'insurance-indemnity-fast-track' THEN
        '{"currency":"INR","annualBenefit":42000000,"implementationCost":6500000,
          "annualOperatingCost":2800000,
          "rationale":"Faster indemnity settlement releases reserve earlier and cuts manual assessment hours. Replace with insurer-specific capacity and settlement assumptions before adoption."}'::jsonb
      WHEN 'lending-delinquency-intervention' THEN
        '{"currency":"INR","annualBenefit":78000000,"implementationCost":9200000,
          "annualOperatingCost":3400000,
          "rationale":"Avoided loss from earlier intervention on 30+ DPD accounts. Replace with the institution-specific avoided-loss hypothesis before adoption."}'::jsonb
      ELSE
        '{"currency":"INR","annualBenefit":31000000,"implementationCost":4800000,
          "annualOperatingCost":2100000,
          "rationale":"Incremental revenue from higher accepted cross-sell conversion, net of RM capacity. Replace with your own revenue and compliance assumptions before adoption."}'::jsonb
    END AS roi
) o
WHERE v.blueprint_id = b.id;

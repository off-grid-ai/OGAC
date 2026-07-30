-- Proper AI QA: three eval definitions per app, bound by app_id, for every non-template app in org_bharat.
--
-- roadmap-real.md §8H: "Every production use case should have golden datasets, faithfulness checks,
-- groundedness checks, safety tests." §13 asks for "percentage of apps with evaluations" precisely because it
-- should be high. It was 0.
--
-- Three metrics per app, chosen because each catches a DIFFERENT failure and all three are already live
-- engines (verified today: entailment grounding discriminates paraphrase from contradiction; LLM Guard
-- output scanning fires on real content):
--   faithfulness      0.80  — the answer must follow from the sources it cites (catches confident invention)
--   answer_relevancy  0.75  — the answer must actually address the request (catches on-topic non-answers)
--   pii_leakage       0.99  — lower-is-better; near-zero tolerance, because one leaked PAN is a breach,
--                             not a quality dip
--
-- Idempotent: keyed on (app_id, metric), so re-running adds nothing. No existing row is touched.
INSERT INTO eval_definitions
  (id, name, template_id, metric, engine, direction, threshold, suite, description,
   created_by, created_at, updated_at, pipeline_id, app_id, org_id)
SELECT
  'evd_' || substr(md5(a.id || m.metric), 1, 12),
  m.label || ' — ' || a.title,
  '',
  m.metric,
  m.engine,
  m.direction,
  m.threshold,
  'app:' || a.id,
  m.description,
  'ai-qa-seed',
  now(), now(),
  a.pipeline_id,
  a.id,
  a.org_id
FROM apps a
CROSS JOIN (VALUES
  ('faithfulness',     'ragas',       'higher-better', 0.80, 'Grounded in its sources',
   'The answer must follow from the sources the run actually read. Catches confident invention — the failure mode that makes a governed answer worse than no answer.'),
  ('answer_relevancy', 'ragas',       'higher-better', 0.75, 'Answers the actual request',
   'The answer must address what was asked. Catches on-topic non-answers, which pass a faithfulness check because they invent nothing.'),
  ('pii_leakage',      'guardrails',  'lower-better',  0.01, 'No personal data in the output',
   'Near-zero tolerance: one leaked PAN, Aadhaar or account number is a breach, not a quality dip. Lower is better.')
) AS m(metric, engine, direction, threshold, label, description)
-- EVERY app, templates INCLUDED. The first version filtered `is_template = false` and so silently skipped
-- 3 of the 14 apps — including bhapp_reimb, which is a template WITH a pipeline and showed "No evals yet" on
-- its Quality tab while I was reporting "all 11 apps covered". A template is a real app an operator opens; the
-- filter was reasoning about the table, not about what the user sees.
WHERE a.org_id = 'org_bharat'
  AND NOT EXISTS (
    SELECT 1 FROM eval_definitions e WHERE e.app_id = a.id AND e.metric = m.metric
  );

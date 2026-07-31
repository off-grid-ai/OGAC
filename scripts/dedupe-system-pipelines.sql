-- ─── Collapse duplicate system pipelines onto their canonical org-scoped id ────────────────────────
--
-- /build/pipelines showed "AI Quality Judge v1" THREE times in org_bharat, identical on every visible
-- field. The system judge is meant to be one governed pipeline per org with a DETERMINISTIC id
-- (pl_system_ai_quality_judge__<org>); the extras are earlier attempts that were created with random ids
-- before that convention landed, and they have been sitting in the demo tenant ever since.
--
-- References are repointed FIRST, then the duplicates are removed — deleting first would orphan any eval
-- definition or app bound to an older id, turning a cosmetic duplication into broken governance.
DO $$
DECLARE
  dup RECORD;
  canonical TEXT;
BEGIN
  FOR dup IN
    SELECT p.id, p.org_id
    FROM pipelines p
    WHERE p.name = 'AI Quality Judge'
      AND p.id <> 'pl_system_ai_quality_judge__' || p.org_id
      AND EXISTS (
        SELECT 1 FROM pipelines q
        WHERE q.org_id = p.org_id AND q.id = 'pl_system_ai_quality_judge__' || p.org_id
      )
  LOOP
    canonical := 'pl_system_ai_quality_judge__' || dup.org_id;
    -- Repoint everything that can bind a pipeline. Each guarded so a missing table/column in some
    -- deployment does not abort the whole migration.
    BEGIN EXECUTE format('UPDATE eval_definitions SET pipeline_id = %L WHERE pipeline_id = %L', canonical, dup.id);
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
    BEGIN EXECUTE format('UPDATE apps SET pipeline_id = %L WHERE pipeline_id = %L', canonical, dup.id);
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
    BEGIN EXECUTE format('UPDATE agents SET pipeline_id = %L WHERE pipeline_id = %L', canonical, dup.id);
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
    -- custom_agents holds a real FK (custom_agents_pipeline_org_fk) — the first run failed here, which is
    -- exactly why references are repointed before any delete.
    BEGIN EXECUTE format('UPDATE custom_agents SET pipeline_id = %L WHERE pipeline_id = %L', canonical, dup.id);
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
    BEGIN EXECUTE format('UPDATE eval_runs SET pipeline_id = %L WHERE pipeline_id = %L', canonical, dup.id);
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
    DELETE FROM pipelines WHERE id = dup.id;
  END LOOP;
END $$;

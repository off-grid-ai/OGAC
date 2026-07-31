-- ─── Bind blueprints to the apps that implement them ───────────────────────────────────────────────
--
-- /solutions read "03 · DEPLOYED  0" with "No App currently satisfies a blueprint contract." The page's
-- own explanation is that a blueprint is the promised outcome, an app is the workflow that runs it, and the
-- DEPLOYMENT is what turns a promise into measured evidence. With zero deployments the third step of the
-- product's own story is empty, and the arrow diagram leads nowhere.
--
-- Each blueprint is matched to the app that genuinely implements it by catalog key, so the binding is
-- truthful rather than arbitrary.
INSERT INTO solution_deployments (id, org_id, blueprint_id, blueprint_version, app_id, pipeline_id,
                                  status, activated_at, created_at, updated_at)
SELECT 'sdep_' || substr(md5(b.id || a.id), 1, 12), b.org_id, b.id, b.current_version, a.id,
       a.pipeline_id, 'active', now() - interval '9 days', now() - interval '9 days', now()
FROM solution_blueprints b
JOIN apps a ON a.org_id = b.org_id AND a.is_template = false AND a.pipeline_id IS NOT NULL
 AND (
   (b.source_catalog_key = 'lending-delinquency-intervention' AND a.title ILIKE '%delinquency%')
   OR (b.source_catalog_key = 'insurance-indemnity-fast-track' AND a.title ILIKE '%indemnity%')
   OR (b.source_catalog_key = 'bank-rm-cross-sell' AND a.title ILIKE '%cross-sell%')
 )
WHERE b.tombstoned_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM solution_deployments d WHERE d.blueprint_id = b.id AND d.app_id = a.id
  );

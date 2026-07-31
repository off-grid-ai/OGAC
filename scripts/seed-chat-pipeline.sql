-- ─── Give each tenant a governed pipeline for CHAT ─────────────────────────────────────────────────
--
-- The chat header read "No pipeline" on both tenants. Founder: *"you should attach a pipeline. what is the
-- demo if there is no pipeline?"* — and he is right: §11 says governance is INHERITED, so an ungoverned chat
-- contradicts the product's central claim on the surface a buyer opens first.
--
-- resolveConsumerPipeline was already correct (project override, else org default); `org_settings
-- .default_chat_pipeline_id` was simply NULL for org_bharat and org_suraksha while org `default` had one.
--
-- A dedicated "Workspace Chat" pipeline rather than reusing a use-case one: the chip is legible to a buyer
-- ("Runs on: Workspace Chat" makes sense; "Runs on: Reimbursement Governance" for a KYC question does not),
-- and chat's data ceiling should be set deliberately rather than inherited from whichever app happened to be
-- broadest. Cloned from the widest published pipeline in the same org so the gateway, model, routing, policy
-- and guardrail overlays are the org's real ones, not invented.
INSERT INTO pipelines (id, org_id, owner_id, name, description, visibility, gateway_id, default_model,
                       routing, data_allowlist, policy_overlay, guardrail_overlay, status, version,
                       is_template, created_at, updated_at)
SELECT 'pl_chat_' || src.org_id, src.org_id, src.owner_id, 'Workspace Chat',
       'Governs Work → Chat for this workspace: the data chat may retrieve, the models it may use, and the '
       || 'policy and guardrails applied to every message. Apps and agents keep their own pipelines.',
       src.visibility, src.gateway_id, src.default_model, src.routing, src.data_allowlist,
       src.policy_overlay, src.guardrail_overlay, 'published', 1, false, now(), now()
FROM (
  SELECT DISTINCT ON (org_id) org_id, owner_id, visibility, gateway_id, default_model, routing,
         data_allowlist, policy_overlay, guardrail_overlay
  FROM pipelines
  WHERE org_id IN ('org_bharat', 'org_suraksha') AND status = 'published'
  ORDER BY org_id, jsonb_array_length(COALESCE(data_allowlist, '[]'::jsonb)) DESC
) src
WHERE NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.id = 'pl_chat_' || src.org_id);

-- Bind it as the org default, and make it selectable in the chat picker.
INSERT INTO org_settings (id, default_chat_pipeline_id, chat_pipeline_allowlist, updated_by, updated_at)
SELECT o.org, 'pl_chat_' || o.org, to_jsonb(ARRAY['pl_chat_' || o.org]), 'seed-chat-pipeline', now()
FROM (VALUES ('org_bharat'), ('org_suraksha')) AS o(org)
ON CONFLICT (id) DO UPDATE
SET default_chat_pipeline_id = EXCLUDED.default_chat_pipeline_id,
    chat_pipeline_allowlist = EXCLUDED.chat_pipeline_allowlist,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

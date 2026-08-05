# AI Runtime — audit findings (2026-08-05)

Section: `src/app/(console)/runtime/**` + model/pipeline/agent-run libs and admin APIs.
Screenshots: `/tmp/audit/runtime/*.png` (harness `scripts/audit-shoot.mjs`, viewport 1600).

## Coverage so far

- [x] Route enumeration of `src/app/(console)/runtime/**` (23 files)
- [x] Shot list routes: /runtime, /runtime/models, /models/cache, /models/spend, /models/callbacks, /runtime/pipelines, /runtime/api, /runtime/api-budgets
- [ ] Judged PNGs
- [ ] Pipeline detail tabs (11 tabs)
- [ ] Model detail `/runtime/models/[destination]`
- [ ] Gateway detail (out of scope — sibling team)
- [ ] `src/lib/pipelines.ts`, `pipeline-execute*.ts`, `agent-run*.ts`, `cache.ts`, `litellm*.ts`, `model-catalog.ts`
- [ ] `src/app/api/v1/admin/{gateway,models,pipelines,agents,runtime}/**`

## Findings

_(appended as confirmed)_

# QA test log

Adversarial QA sweeps. `- [ ]` = open break proven by a RED test; see `docs/adversarial/*.md` for
axes/journeys/repro and `docs/GAPS_BACKLOG.md` (G-ADV-*) for the tracked gap.

## Governance / Guardrails / PII

- [ ] chat inbound guardrail, engine throws → fails OPEN: injection block bypassed + raw PAN reaches model (src/app/api/v1/chat/stream/route.ts:156 | G-ADV-GOV-1)
- [ ] chat outbound guardrail, engine throws → verdicts dropped to []; audit reads as a clean screen that never ran (src/app/api/v1/chat/stream/route.ts:677 | G-ADV-GOV-2)
- [ ] app-run inbound → NO mandatory guardrail floor; injection/PII screen only transitive via a nested agent step (src/lib/app-run.ts:399 | G-ADV-GOV-3)
- [ ] app-run + pipeline PII mask → detector throw sends prompt to model UNMASKED (best-effort catch) (src/lib/app-run.ts:503, src/lib/pipeline-execute.ts:201 | G-ADV-GOV-4)

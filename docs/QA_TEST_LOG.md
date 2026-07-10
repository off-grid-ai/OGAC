# QA Test Log — founder-verifiable flows

Each line is a flow a founder can walk to see the break with their own eyes. Format:
`- [ ] <flow> → <what breaks / what the user sees> (file:line | GAP-ref)`

## Pipelines

- [ ] Create a pipeline, leash a PII data-class to LOCAL but pin no explicit local model, set its default model to a cloud model, then call it → the response + audit say `egress: "local"` while the prompt actually goes to the cloud model (local leash is only an advisory hint to the gateway, not enforced on the model choice) (src/lib/pipeline-run-plan.ts:70 | G-ADV-PIPE-1)
- [ ] Bind an app/agent/chat to a pipeline, then Deprecate (or Archive) that pipeline → the UI says "consumers fall back to the org default", but the consumer keeps running the DEPRECATED pipeline's contract; the fallback never happens (src/lib/pipeline-contract.ts:32 | G-ADV-PIPE-2)
- [ ] Bind an app to a pipeline still in Draft / In-review (never approved, eval gate never run) and run the app → it runs the un-published pipeline's governance live, even though the public API 409s the same pipeline as "not published" (src/lib/pipeline-contract.ts:32 | G-ADV-PIPE-3)
- [ ] Same deprecated/draft pipeline hit via its provisioned API key → correctly refused (409 "not published"), proving the internal consumer paths are the ones missing the gate (src/app/api/v1/pipeline/[id]/run/route.ts:64 | G-ADV-PIPE-2/3)

# QA test log — known-broken user flows (adversarial sweep)

The QA adversary's job: **prove the developer wrong.** Each line below is a user flow or user-facing
behavior an adversarial pass believes is BROKEN (or a SOLID/DRY/SoC violation that will cause a break).
This is the founder-verifiable list: **fix → then Mac tests the exact bullet.** Nothing is fixed blindly.

Legend: `[ ]` suspected-broken (needs fix + verify) · `[~]` fixed, awaiting Mac's verify · `[x]` Mac-verified fixed.
Each bullet: **the flow** → what breaks (the terminal thing the user sees/doesn't) · `(file:line root-cause | GAPS ref)`.

> Sourcing: per-domain detail + coverage ledgers in `docs/adversarial/<domain>.md`; every line also in
> `docs/GAPS_BACKLOG.md` (G-ADV-*). This file is the skimmable index of BROKEN flows only.

---

## Tenant isolation / access (adversarial pass complete)
- [ ] Read-only viewer opens Connectors → connection-string `endpoint` shows inline DB creds (`postgres://corebank:corebank@…`) unredacted; the "view everything but no secrets" promise leaks embedded creds. `(connectors reader bypasses redactSecretForViewer | G-SEC-VIEWER-1)`
- [~] Bank login silently worked on the insurer host (felt like one system / insecure). FIXED (host-scoped cookies + host-pinned post-login redirect) — awaiting Mac verify on both tenants. `(AUTH_COOKIE_DOMAIN removed | SERVER_STATE)`

## Stale product UI / positioning + broken pages (found by live re-capture #222)
- [ ] Open `/gateway/fleet` → page ERRORS ("Something went wrong here"). Nav still shows "Fleet" (section "GATEWAY & FLEET") on every authenticated screen; surface was repurposed to device-MDM but is broken + should be coming-soon. `(build/agents+studio nav; /gateway/fleet route | G-ADV-FLEET)`
- [ ] Open `/insights/lineage` → ERRORS ("not enabled for this deployment") instead of graceful empty/coming-soon state. `(insights/lineage route)`
- [ ] Gateway cards (`/gateway/registry` + gateway detail) still render "data leaves (cloud) / data stays on-prem" egress badges + "each with its egress class" — the killed privacy-moat framing, live in product code. `(gateway card component)`
- [ ] Studio + Agents home show a "Grounded in the Brain" stat; "Brain" copy still scattered in landing/features/data pages ("Push the Brain's documents into Qdrant"). Brain was removed/renamed. `(build/studio/page.tsx:98, build/agents/page.tsx:98, features, fleet-control, data/page.tsx:211)`
- [ ] Services page shows raw OSS names (Keycloak/Qdrant) alongside capability names; Overview shows "LLM-GUARD engine unreachable" (red); Retrieval page exposes "lancedb"/"Qdrant"/`OFFGRID_ADAPTER_RETRIEVAL=qdrant` env vars — OSS-engine names leaking to customer-facing UI. `(services page, overview health, retrieval page)`
- [ ] App chrome shows privacy positioning product-wide: footer "ON-PREM · LOCAL-FIRST", signin "ON-PREM · SECURE" — stale per current positioning (control/no-lock-in/one-system, not on-prem-as-moat). `(app shell footer, signin)`
> NOTE: 34 fresh screenshots (6 tour + 28 docs) captured on worktree-agent-a15af769 (Brain gone from nav, capability names, rich BFSI data) — but they still carry the privacy badges + "Grounded in the Brain" stat above because those are LIVE in product code. Re-shoot AFTER the product-UI fixes above, else the shots embed the stale UI. Brain docs-content removal on that branch is good to keep.

## Chat  (adversarial pass complete — VERIFIED on current wave2; red tests on worktree-agent-a98e011d)
- [ ] **CRITICAL — cross-org RAG document leak.** `chat_documents`/`chat_chunks` have NO org_id; `retrieve()` filters by project_id only; the stream route never checks the conversation's project belongs to the request org. A user in 2 orgs can open an org-B chat pointed at an org-A project and get answers grounded on + CITING org-A confidential docs. VERIFIED on wave2 (schema has no org_id, rag.ts:146 project-only). Precondition: a multi-org user — NOT exploitable by the single-org read-only demo viewer, but a real isolation hole. `(src/lib/rag.ts:137/146; chat/stream/route.ts:269 | G-ADV-CHAT-1)`
- [ ] **HIGH — inbound guardrail fails OPEN.** `runInboundGuardrails(...).catch(() => null)` (stream/route.ts:156): if the guardrail engine throws (down/misconfig), the turn is ALLOWED and the original unredacted message goes to the model. The underlying fn fails closed; the route's swallow inverts it. VERIFIED present on wave2. `(chat/stream/route.ts:156 | G-ADV-CHAT-2)`
- [ ] **HIGH — prompt-injection breakout via attachment.** `attachmentBlock` interpolates filename+text into `<file name="…">…</file>` with NO escaping → a crafted attachment closes the tag early and injects `<system>` instructions. `(src/lib/chat-attach.ts | G-ADV-CHAT-3)`
- [ ] **HIGH — prompt-injection breakout via referenced memory.** same missing escaping in `referencedMemoryBlock`/`memoryBlock`. `(src/lib/chat-mentions.ts | G-ADV-CHAT-4)`
- [ ] MED — control-token leak (OD14 class): no `stripControlTokens` in the chat content path; `<function=…>`/`<think>`/`<tool_call>`/`<|im_start|>` render as literal visible text AND are read aloud by TTS (leaks chain-of-thought). Fix seam: one shared pure `stripControlTokens()`. `(chat-audio.ts:217 + renderer | G-ADV-CHAT-5)`
- [ ] MED — stop mid-stream doesn't cancel the server run: client `stop()` aborts only the browser fetch; the route ignores `req.signal`, reads upstream to completion, STILL persists the full answer + dispatches the durable Temporal run → refresh shows a different answer + orphaned run. `(ChatWorkspace.tsx:946; stream/route.ts | G-ADV-CHAT-6)`
> non-blocking: outbound guardrail is record-only (can't block an already-streamed answer); client SSE JSON.parse unguarded per-frame. Untested (logged): tool-approval token replay, MCP timeout, HITL resume, send-ordering races, budget under-count, renameConversation cross-org.
## Builder / Studio / Projects  (adversarial pass complete — red tests on worktree-agent-a1f37b93)
- [ ] HIGH: a CYCLIC app (e→a→b→a, or self-loop a→a) is ACCEPTED by `validateAppSpec` (checks entry+reachability, NOT acyclicity) via POST/PATCH/NL-compose → at run time it WEDGES: status stuck `running`, cycle steps `queued` forever, no completion, no error. DRY/SoC: the cycle rule exists ONLY in the canvas editor (`wouldCreateStepCycle`), missing from the validator the store+executor trust. One fix (add acyclicity to validateAppSpec) closes both. `(src/lib/app-model.ts:129 | G-ADV-BUILD-1/2)`
- [ ] HIGH: HITL resume re-fires an added sink N times on spec-drift — edit an app (append an output/email step) while a run is paused at a human step, approve → the added sink fires 6× for one approve. Resume rebuilds state from the OLD row but drives the CURRENT edited spec; `applyStepResult` no-ops for absent steps so never records done. `(src/lib/app-run-plan.ts:202; review route | G-ADV-BUILD-3)`
- [ ] MED: webhook payload clamp is top-level-only — a 5MB nested string / 200k-element array / 5000-deep nesting all pass whole into the governed pipeline input (contradicts the "stays small and typed" contract). `(src/lib/trigger-dispatch.ts:132 sanitizeBody | G-ADV-BUILD-5)`
- [ ] LOW/MED: concurrent HITL approve is a check-then-act race on the inline path (no row lock; durable path is idempotent) `(G-ADV-BUILD-4)`; app→app `MAX_APP_TOOL_DEPTH` never arms (depth/callerAppId not threaded through recursive submitAppRun) — static org-wide cycle guard still blocks mutual refs so no hard infinite loop `(G-ADV-BUILD-6)`.
> Robust-verified ✓: unbound data-domain/missing connector → honest runtime error (no fabrication); malformed webhook → graceful fallback; unsigned token → 401 fail-closed (live); builder create/run require admin → 401 unauth (live); out-of-order review → 409; app→app composition cycle → static guard refuses.
## Gateway / Model settings  (adversarial pass complete — red tests on worktree-agent-ae1cd749)
- [ ] HIGH: a NaN clock permanently wedges a rate-limit bucket — `resetAt=NaN`, `now > NaN` always false → key/IP denied FOREVER with `retryAfterSec=NaN`, never self-heals (self-DoS, fail-closed). `(src/lib/rate-limit.ts:56 — no guard on now | G-ADV-GW-1)`
- [ ] MED: cloud route mis-selects provider on a mid-string token — `my-local-model:openai:v2` → routes to openai with corrupted model "v2" (substring match, not anchored). `(src/lib/cloud-providers.ts:187 selectCloudProvider | G-ADV-GW-3)`
- [ ] LOW/MED: PATCH a non-compat gateway with `baseUrl:''` → persists an empty baseUrl (unusable row), no error (emptiness guard only checks kind==='compat'). `(src/lib/…/gateways.ts:198 updateGateway | G-ADV-GW-4)`
- [ ] SEC: per-IP rate floor trusts client `x-forwarded-for` when `cf-connecting-ip` absent → off-Cloudflare, rotating XFF bypasses the floor. `(middleware clientIp | G-ADV-GW-5)`
- [ ] SCALE: rate-limit counters are module-level in-memory maps → per-instance, not shared; a scaled/multi-instance deploy multiplies the effective limit. `(src/middleware.ts counters | G-ADV-GW-10)`
- [ ] revocation fails OPEN on a resolver DB error (edge admits a revoked key at the floor during a DB hiccup; Keycloak at aggregator is the real gate). `(G-ADV-GW-6)` · no DB uniqueness on gateway baseUrl/hostname → silent duplicates `(G-ADV-GW-7)` · `isGatewayApiKey` looser than `parseApiKey` `(G-ADV-GW-8)` · gateway-keys POST passes `ownerOrg` to Keycloak unvalidated `(G-ADV-GW-9)`
> Robust-verified ✓ (tried, held): rate-limit boundary (60th ok/61st denied), egress leash (cloud&&!allowed→block, both decideRouting+planCloudRoute), disable, API-key parse/verify, bound-to-deleted-gateway → clean error not fake 200, viewer write-block + requireAdmin on all gateway routes.
## Settings / Configuration  (adversarial pass complete — red tests on worktree-agent-aac54391)
- [ ] HIGH: edit a host config field (e.g. a backend URL) + save → persists LOOPBACK (`127.0.0.1`), not the real target — `configConnectValue`/`isPrivateIPv4` collapse any RFC-1918 IP to S1→loopback; connectivity breaks on any box not co-located with S1. (VERIFY if intentional for single-S1 vs a real multi-node bug.) `(src/lib/config.ts:57,87 + display-host.ts | G-ADV-SET-1/3)`
- [ ] MED-HIGH: config `reveal` returns the RAW host (`http://127.0.0.1:4000`) not the display host → list shows `offgrid-s1.local` but reveal shows loopback (drift + no-raw-host rule violation); also redacts for viewer WITHOUT checking the key's `secret` flag (over-redacts non-secrets). `(reveal/route.ts:17,22 | G-ADV-SET-5)`
- [ ] MED: connector PATCH validates only `auth` → a bogus `type` / malformed `endpoint` persists with 200 and silently breaks the connector (POST validates it, PATCH doesn't — validation not reused). `(connectors/[id]/route.ts:16 | G-ADV-SET-4)`
- [ ] LOW: host round-trip not idempotent (trailing-slash drift → unreliable dirty-detection/audit diffs) `(G-ADV-SET-2)`; ROI "current" value seeded once from props, never re-seeded post-save (§A stale-copy) `(G-ADV-SET-6)`.
- [ ] SoC/DRY (why things break): rate-limit normalization defined 3× (KeyRateLimit.tsx:50 + keys/[id]/route.ts + rate-limit-store.ts); connector create-validation not reused on update; realm-lifetimes validation duplicated; reveal redaction ignores the registry `secret` flag. `(G-ADV-SET DRY)`
> ⚠️ also flagged for the gap agent: secret field not cleared on error (SealControl/IdpList), backups config not editable. Robust-verified ✓: ROI PUT validates server-side; connector password write-only/hashed/never echoed; observability threshold re-validates.
## Pipelines  (queued)
## Data / ETL / Connectors  (queued)
## Governance / Guardrails / PII  (queued)
## Observability / Insights  (queued)
## Consumption (triggers → run → sinks)  (queued)
## Secrets / config  (queued)

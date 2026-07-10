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

## Chat  (adversarial agent running — findings will land here)
## Builder / Studio / Projects  (adversarial agent running)
## Gateway / Model settings  (adversarial pass complete — red tests on worktree-agent-ae1cd749)
- [ ] HIGH: a NaN clock permanently wedges a rate-limit bucket — `resetAt=NaN`, `now > NaN` always false → key/IP denied FOREVER with `retryAfterSec=NaN`, never self-heals (self-DoS, fail-closed). `(src/lib/rate-limit.ts:56 — no guard on now | G-ADV-GW-1)`
- [ ] MED: cloud route mis-selects provider on a mid-string token — `my-local-model:openai:v2` → routes to openai with corrupted model "v2" (substring match, not anchored). `(src/lib/cloud-providers.ts:187 selectCloudProvider | G-ADV-GW-3)`
- [ ] LOW/MED: PATCH a non-compat gateway with `baseUrl:''` → persists an empty baseUrl (unusable row), no error (emptiness guard only checks kind==='compat'). `(src/lib/…/gateways.ts:198 updateGateway | G-ADV-GW-4)`
- [ ] SEC: per-IP rate floor trusts client `x-forwarded-for` when `cf-connecting-ip` absent → off-Cloudflare, rotating XFF bypasses the floor. `(middleware clientIp | G-ADV-GW-5)`
- [ ] SCALE: rate-limit counters are module-level in-memory maps → per-instance, not shared; a scaled/multi-instance deploy multiplies the effective limit. `(src/middleware.ts counters | G-ADV-GW-10)`
- [ ] revocation fails OPEN on a resolver DB error (edge admits a revoked key at the floor during a DB hiccup; Keycloak at aggregator is the real gate). `(G-ADV-GW-6)` · no DB uniqueness on gateway baseUrl/hostname → silent duplicates `(G-ADV-GW-7)` · `isGatewayApiKey` looser than `parseApiKey` `(G-ADV-GW-8)` · gateway-keys POST passes `ownerOrg` to Keycloak unvalidated `(G-ADV-GW-9)`
> Robust-verified ✓ (tried, held): rate-limit boundary (60th ok/61st denied), egress leash (cloud&&!allowed→block, both decideRouting+planCloudRoute), disable, API-key parse/verify, bound-to-deleted-gateway → clean error not fake 200, viewer write-block + requireAdmin on all gateway routes.
## Settings / Configuration  (adversarial agent running)
## Pipelines  (queued)
## Data / ETL / Connectors  (queued)
## Governance / Guardrails / PII  (queued)
## Observability / Insights  (queued)
## Consumption (triggers → run → sinks)  (queued)
## Secrets / config  (queued)

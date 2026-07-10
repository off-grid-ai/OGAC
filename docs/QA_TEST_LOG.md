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
## Gateway / Model settings  (adversarial agent running)
## Settings / Configuration  (adversarial agent running)
## Pipelines  (queued)
## Data / ETL / Connectors  (queued)
## Governance / Guardrails / PII  (queued)
## Observability / Insights  (queued)
## Consumption (triggers → run → sinks)  (queued)
## Secrets / config  (queued)

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

# Unified identity & the console-as-integration-bus — research + plan (2026-07-05)

**Goal.** One Keycloak identity valid across the whole stack: a user's OIDC session or a machine's
service-account JWT (client_credentials) is accepted everywhere, and when services need each other
they go **through the console's authenticated API handler** — never ad-hoc service-to-service.
**Constraint:** every backend is a *stock Docker image* — we integrate at the config / edge / console
layer, no patching the images.

This doc is the output of a three-plane research sweep (identity · data/observability · ops/exec/
storage), file:line-verified against the code and each image's real auth capability.

---

## The pattern: the console is the identity broker + the bus

The console **already has every seam** this needs:
- **Verify Keycloak JWTs** — `src/lib/auth/token-verifier.ts` (JWKS-cached RS256/ES256 signature + issuer + audience). The aggregator mirrors it in `scripts/lib/keycloak-verify.mjs`.
- **Authorize** — `src/lib/authz.ts` (`requireUser`/`requireAdmin`) + ABAC/OPA.
- **Store service credentials** — `src/lib/adapters/secrets.ts` (OpenBao KV v2).
- **Mint service tokens** — `src/lib/keycloak-admin.ts` already does `client_credentials`.

So the flow for **every** access, user or machine:

```
client ──(Keycloak token / session)──▶ CONSOLE API handler
                                         │  1. verify Keycloak token   (token-verifier)
                                         │  2. enforce ABAC/policy      (authz + OPA)
                                         │  3. fetch service cred       (OpenBao)
                                         └─ 4. call downstream with that cred ─▶ service
```

Three sub-patterns, by what the stock image can do:

1. **native-OIDC** — the image validates Keycloak tokens itself (for its own UI/API). Configure the
   image + create a Keycloak client. Used for the services with their own UI people log into.
2. **console-brokered** *(the default, = "through the console API handler")* — the console holds the
   service credential (from OpenBao) and is the only caller; downstream trusts the console on the
   private network. This is what most integrations already do; we just formalize the credential.
3. **edge-gated** — no-auth images sit behind Caddy `forward_auth` → the console's `/api/auth/verify`
   (already how Provit/status/landing are gated), or are reachable only via a console proxy route.

---

## Per-service matrix (verified)

| Service | Image auth reality | Verdict | What to build |
|---|---|---|---|
| **Keycloak** | the IdP | identity source | service-account clients per downstream service |
| **AI Gateway** (aggregator) | **already verifies Keycloak JWT** (`keycloak-verify.mjs`) but the console calls it with a static `x-api-key` | console-brokered | swap the static key → a minted Keycloak service JWT; auth the `/pool` refresh |
| **OpenSearch** | security plugin supports **OIDC + JWT** natively (disabled today: `DISABLE_SECURITY_PLUGIN=true`) | native-OIDC (or brokered) | enable security plugin + OIDC/JWT config → KC client; or keep brokered + add a proxy route |
| **Superset** | Flask-AppBuilder **OAuth** (needs `superset_config.py`); API is session-token, not JWT | console-brokered | guest-token embed already brokered; optional OAuth for direct logins; store admin creds in OpenBao |
| **FleetDM** | native **SAML/OIDC** SSO; API uses tokens | console-brokered | KC client + service token from OpenBao (replace static `FLEET_TOKEN`); optional UI SSO |
| **Temporal** | no auth in dev; supports **mTLS + bearer/claim-mapper** | edge-gated + brokered | Caddy-gate the UI; add mTLS + service JWT to the gRPC client; pass user context into activities |
| **SeaweedFS** | S3 **IAM via `identities.json`** (keys), no OIDC | console-brokered | mint S3 access/secret keys, store in OpenBao, console signs SigV4 (drop anon loopback) |
| **OpenBao** | dev root token; supports an **OIDC auth method** | secrets store | prod: persistent backend + OIDC auth; hold every other service's credential |
| **OPA** | **no auth** (stateless decision API) | console-brokered | none (trusted LAN, console-only caller); optional edge gate |
| **Presidio** | **no auth** | edge-gated | Caddy `forward_auth` on 8938/8939 (or console proxy) — never expose raw |
| **Marquez** | **no auth** | edge-gated | Caddy `forward_auth` on :9000 (or console proxy) |
| **Langfuse** | email/pw UI; API is **Basic (project keys)**, no OIDC | console-brokered | move project keys env → OpenBao; console is the only reader |
| **Unleash** | frontend eval token + Admin API token | console-brokered | Admin token in OpenBao (management landed in Phase 4.9) |

**Shape of the truth:** the console-brokered pattern is already the de-facto reality for most services
— they're reached only by the console over the private LAN. What's missing is **formalizing the
identity**: real per-service credentials (not static keys / anon access), held in OpenBao, minted from
Keycloak, injected by one shared console helper — plus edge-gating the three no-auth services so
nothing is reachable unauthenticated.

---

## The one primitive that unlocks it: a service-token broker

Today each adapter hard-codes its own auth (static gateway key, static Fleet token, anon S3, Langfuse
keys in env). Replace all of that with **one helper**:

```
getServiceCredential(service): fetch client secret from OpenBao → Keycloak client_credentials grant
                               → cache the JWT (refresh before exp) → return Bearer / SigV4 keys
```

Then every adapter (`gateway.ts`, `mdm.ts`, `files.ts`, `langfuse.ts`, `secrets.ts`, `superset.ts`,
`marquez.ts`, `pii.ts`) authenticates through it. One seam, uniform identity, credentials rotate in
OpenBao without code changes.

---

## Integration-points build plan (phased)

**Phase A — the broker + Keycloak clients (foundation)**
1. Create Keycloak service-account clients: `offgrid-gateway`, `offgrid-opensearch`, `offgrid-fleet`,
   `offgrid-temporal`, `offgrid-seaweedfs` (+ audience/role mappers). Seed in `deploy/keycloak/*realm*`.
2. Store each client secret / S3 keypair in OpenBao (`secret/<service>/…`).
3. Build the `getServiceCredential()` broker helper (+ in-memory cache/refresh) and unit-test the pure
   token-lifecycle logic.

**Phase B — swap adapters to the broker (console-brokered set)**
4. `gateway.ts`: static `x-api-key` → minted Keycloak JWT; authenticate the aggregator `/pool` refresh.
5. `files.ts`: anonymous loopback S3 → SigV4 with OpenBao keys (seed `identities.json`).
6. `langfuse.ts`: project keys from OpenBao, not env.
7. `mdm.ts`: Fleet service token from OpenBao.

**Phase C — edge-gate the no-auth services**
8. Caddy `forward_auth` (the existing `(gated)` snippet) on Presidio (8938/8939) and Marquez (:9000);
   OPA stays console-only on the trusted LAN. Nothing reachable unauthenticated.

**Phase D — native-OIDC for the UI services (direct SSO)** — **CONFIG READY (2026-07-06), NOT enabled**
9. OpenSearch: enable the security plugin + OIDC/JWT (KC client) so Dashboards + API take Keycloak.
10. FleetDM SSO + Superset OAuth (`superset_config.py`) for people who open those UIs directly.

> **Status (2026-07-06).** The Phase-D config is delivered as a **one-flag enable** — nothing is
> flipped live (enabling is an on-site maintenance step). Deliverables:
> - **Config file:** `deploy/onprem/oidc-services.md` — verbatim, ready-to-flip config for all three
>   (OpenSearch security-plugin `config.yml` OIDC+JWT / Dashboards yml / roles-mapping; FleetDM
>   `sso_settings` + `FLEET_SSO_*` env; Superset `superset_config.py` AUTH_OAUTH), each with issuer/JWKS
>   endpoints, audience, and step-by-step enable instructions.
> - **Compose staging:** `services-node-a.yml` (OpenSearch) + `services-node-b.yml` (FleetDM, Superset)
>   carry commented, ready-to-uncomment mounts/env pointing at those config blocks.
> - **Keycloak clients:** `offgrid-opensearch` + `offgrid-fleet` already existed; **`offgrid-superset`
>   is new** (login client — `standardFlow` + `oauth-authorized/keycloak` redirect + audience mapper +
>   role `svc-superset`), added to the realm seed AND the code SSOT (`src/lib/service-clients.ts`).
> - **Honest ready-vs-enable split + on-site steps:** `SERVER_STATE.md` § "Native-OIDC for UI services
>   (Phase D — READY, NOT enabled)".
>
> **The one gotcha:** enabling OpenSearch security is NOT flip-and-forget — the console reads OpenSearch
> anonymously over loopback today (`DISABLE_SECURITY_PLUGIN=true`). Turning security on requires the
> PAIRED broker-plan flip `opensearch: 'none'→'oidc-jwt'` in `service-credentials-lib.ts` in the SAME
> change, or console analytics/audit reads 401. FleetDM/Superset OIDC are login-only → no console impact.

**Phase E — hardening**
11. OpenBao prod mode (persistent backend + OIDC auth method, drop the dev root token).
12. Temporal mTLS + claim-mapper; pass the caller's identity/ABAC context into worker activities so a
    durable run carries the same identity as the synchronous path.

**Definition of done:** one Keycloak credential works across every surface; no static keys / anon
access remain; every no-auth image is edge-gated; all cross-service calls flow through the console
handler with a per-service credential from OpenBao; and a durable (Temporal) run carries the same
identity + policy context as an inline run.

---

## Cross-service composition (the adjacent concern)

Unified identity is necessary but not sufficient for "services integrate *well*" — the other axis is
that one governed run should **compose**: policy → guardrails → retrieval → gateway → grounding →
provenance, fanning out to audit (OpenSearch) + trace (Langfuse) + lineage (Marquez), all correlated
by one run id. `runAgent()` is the spine that already chains these; a follow-up audit should verify
every stage fires and the same run id propagates across the audit/trace/lineage/provenance planes
(and inside the Temporal activity). Tracked separately from this identity work.

---

*Sources: three file:line-verified research sweeps (identity-plane, data/observability, ops/exec/
storage), 2026-07-05. Evidence lives in the session transcript; key files: `token-verifier.ts`,
`authz.ts`, `keycloak-admin.ts`, `adapters/secrets.ts`, `gateway.ts`, `scripts/lib/keycloak-verify.mjs`,
`adapters/{mdm,pii,lineage,flags}.ts`, `superset.ts`, `langfuse.ts`, `marquez.ts`, `files.ts`.*

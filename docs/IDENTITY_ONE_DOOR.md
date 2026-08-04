# One door: Keycloak owns identity, nobody logs into a component

**Direction, set by the founder 2026-08-04:** *"we shouldn't have to log in to any particular composable
service on our own — it should just work. Everything should be controlled by Keycloak."*

This is right, and the current state violates it. It came up because I asked for "a Superset admin
browser session" and "an Unleash admin token" — treating a design defect as a favour to ask for. An
operator should never hold a credential for a component. The console is the only door; Keycloak is the
only identity.

## What exists today (the defect)

The deployment carries **16 per-service credentials** in `.env.local`, including
`OFFGRID_SUPERSET_USERNAME` / `_PASSWORD`, `OFFGRID_KESTRA_PASSWORD`, `OFFGRID_WAREHOUSE_PASSWORD`,
`OFFGRID_PRESIDIO_IMAGE_REDACTOR_TOKEN`, `OFFGRID_GATEWAY_API_KEY`, `OFFGRID_OPENBAO_TOKEN`. Each is a
long-lived static secret, scoped to nothing, rotated by hand, and invisible to any audit trail. Only
OpenSearch has been cut over to Keycloak OIDC (see `project-opensearch-oidc-cutover`), and that cutover
is the working pattern to copy.

## Target shape

1. **Every human login is Keycloak OIDC.** No component has its own user directory. A person signs in
   once; the console and every surface behind it trust that token.
2. **Every service-to-service call uses a short-lived credential issued by OpenBao**, with the workload
   authenticating to OpenBao against Keycloak — not a static API key in an env file. OpenBao already
   does dynamic DB credentials here (`project-openbao-secrets-live`), so the mechanism is proven.
3. **No component is exposed to a user directly.** If a component cannot do OIDC, that is not a reason
   to hand someone its password — it is a reason to keep the console the only path to it.

## Per-service truth, including what upstream will NOT allow

Honest inventory, because promising "Keycloak everywhere" and then discovering a paywall is worse than
saying it now:

| Service | OIDC in the edition we run? | Plan |
|---|---|---|
| **Superset** | **Yes** — Flask-AppBuilder `AUTH_OAUTH` in `superset_config.py` | Cut over. Then embed registration is an action by a Keycloak-authenticated admin, and `OFFGRID_SUPERSET_USERNAME/PASSWORD` are deleted. This also removes the ask I made. |
| **OpenBao** | **Yes** — OIDC/JWT auth method | Make it the credential broker; retire `OFFGRID_OPENBAO_TOKEN` as a static root-ish token. |
| **OpenSearch** | **Yes** — already done | Reference implementation. |
| **Unleash** | **NO** — SSO/OIDC is an Enterprise feature; OSS cannot | Never expose it to a person. Console-only access, credential held in OpenBao and rotated, or replace it with a flag store we can govern. |
| **Kestra** | **NO** in OSS 1.x — basic auth only, SSO is Enterprise | Same treatment: console-only, credential in OpenBao. |
| **ClickHouse (warehouse)** | Not OIDC for SQL users | Broker access; no shared password in env. |
| **Presidio / guardrail / gateway** | Service-to-service, no user identity | Short-lived OpenBao-issued credentials, not static keys. |

## Acceptance bar

Done means: `.env.local` contains **no** per-service human credential; a person's access to every
surface is decided by their Keycloak identity and revoked by revoking it there; and the two services
whose OSS edition cannot do OIDC are unreachable except through the console. Anything less is the
current defect with better documentation.

## Why this is not a nice-to-have

Access review, revocation and audit are all claims we make. Every static credential in that list is a
path that a Keycloak revocation does not close — so "revoke a leaver's access" is not currently true for
components, only for the console. That is a governance gap, not a convenience gap.

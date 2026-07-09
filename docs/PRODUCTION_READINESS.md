# Production readiness — investigative review (2026-07-09)

Triggered by a live finding: the Suraksha tenant subdomain showed the `default` org's chats.
Three read-only audits (tenant isolation · auth/authz/secrets · reliability/ops) + live prod probes.

## Verdict, in one line per deployment mode

| Mode | Verdict | Why |
|---|---|---|
| **Demo** (you driving, one tenant) | ✅ **YES** | Works end-to-end; governance run-paths, provenance, evals are real and tested. |
| **Single-tenant production** (one customer, their own box, `OFFGRID_ORG` pinned) | 🟡 **CLOSE** (days) | Cross-tenant leaks collapse to non-issues when pinned to one org; must still fix ~4 secret/gate items that apply regardless. |
| **Multi-tenant production** (≥2 orgs on one deployment) | ❌ **NO** | Tenant isolation is **systemically broken** — ~16 surfaces leak across tenants; needs schema migrations + a scoping sweep + tests. |

**The core engine is strong; the multi-tenant safety envelope around it is unfinished.** This is not "the platform is bad" — the governance enforcement, the auth *machinery*, the coverage gate, and ~12 correctly-isolated surfaces are textbook. The gap is that tenant isolation is enforced per-store-call and a meaningful set of surfaces skip it.

## P0 — cross-tenant leaks (block multi-tenant prod)

Two root causes: **(A)** store fn filters by `id`/`userId` only, no org; **(B)** table has **no `org_id` column at all** (needs a migration, not just a WHERE).

Worst offenders, fix first:
1. **Audit log read** (`siem.ts searchAudit`, `/audit`, `/admin/audit-search`) — every tenant sees every tenant's audit trail. Compliance-fatal. Also `/api/v1/audit` is **ungated** (any logged-in user).
2. **Gateway logs** (`/gateway/logs` + traffic/finops/analytics/nodes/pool) — **ungated AND unscoped**; exposes raw prompt+completion **content** fleet-wide, full-text searchable.
3. **Fleet devices** (`/api/v1/devices` ungated; `devices` table has no org column) — any user reads the whole fleet; **device kill/wipe reachable across tenants by id** (destructive).
4. **Users / SCIM** (`listUsers` no WHERE) — full cross-tenant user directory; feeds IdP provisioning.
5. **`org_settings` singleton** (`id='org'`) — ALL tenants share ONE config row (system prompt + governed chat-pipeline allowlist). Design assumes single-tenant.
6. **Gateway API keys** (`listGatewayKeys`/`revoke`) — list/revoke any tenant's gateway credentials.
7. Whole tables with **no org_id**: `chat_skills`, `prompt_library`, `prompt_partials`, `eval_definitions`, `golden_cases`(has col, ignored), `alert_rules`, `saved_views`, `custom_roles`, `abac_rules`, `feature_flags`, `report_templates`, `audit_events`(v1).
8. **Agent runs by id** (`getAgentRun`/`delete`/`cancel`) — read/delete/cancel any tenant's run.
9. **Routing rules** (`evaluateRouting` runs ALL tenants' rules together; mutations by id only).
10. **Connector sync history** (`listSyncHistory` no org) — leaks other orgs' ingest jobs.

✅ **Fixed + deployed today:** chat conversations + projects (`be152ad`). Chat still has follow-ups (memory, artifacts, `deleteAllConversations` cross-org).

## P1 — apply even to SINGLE-tenant prod (secrets / fail-open)

- **OpenBao token fails OPEN** (`adapters/secrets.ts:39`) → falls back to public dev root token `offgrid-dev-token` if `OFFGRID_OPENBAO_TOKEN` unset. Not in `.env.production` template. **Fail closed.**
- **Signing key fails OPEN** (`sign.ts:6`) → provenance/answer signatures forgeable if `OFFGRID_SIGNING_KEY` unset. **Fail closed.**
- **Gateway-config secrets plaintext at rest** (`gatewayConfig.value`) — vault via the existing `secretRef` pattern.
- **Legacy connector endpoints** may embed plaintext creds (new ones are vaulted — OK).
- **Admin-token compare not constant-time** (`authz.ts:29` `!==`) — use `timingSafeEqual`.
- **`DEFAULT_ORG='default'` pooling** — a principal with no org claim resolves to shared `default`; fail closed in multi-tenant mode.

## What is genuinely SOLID (do not regress)

- **Authentication** is production-ready: real RS256/ES256 JWKS verification + issuer allowlist (`token-verifier.ts`), least-privilege machine roles, dev-login double-gated (`AUTH_DEV_LOGIN && NODE_ENV!==production`, server-side, no client leak).
- **Gate discipline**: ~130/133 admin routes call `requireAdmin`.
- **Governance run-paths**: pipeline/app/agent/chat runs enforce contract + PII-mask + guardrails + egress leash + audit (verified this session; the pipeline public API is a good template).
- **Edge**: Caddy Coraza WAF + per-IP rate limit + forward_auth; CORS `ACAO:*` with no Allow-Credentials (correct); backend services loopback/firewall-confined.
- **~12 surfaces correctly isolated**: pipelines, gateways, custom agents, apps, app-runs, data-domains, guardrail rules, teams, provit, data-governance, publish-jobs, store.ts registry/connectors/masking. **The correct pattern already exists in-repo** — remediation is replication, not invention.
- **≥85% coverage gate** enforced by pre-push hook.

## Reliability / ops (audit still landing — interim, from known facts)

- Single control-plane node (S1); git broken on server (rsync-only deploy); one Postgres; intermittent build init-crash; backups staged not confirmed running. Acceptable for controlled/single-tenant; a DR + HA story is needed for customer-operated prod.
- G-F4 data-quality sidecar still reports the stub on S2 (adapter deployed).

## Recommended path

1. **If the near-term goal is the insurer demo / single pilot:** pin `OFFGRID_ORG`, fix the P1 secret-fail-open + timing items + gate the 3 ungated reads (devices/audit/gateway-logs). Small, days.
2. **For multi-tenant GA:** run this as a dedicated **tenant-isolation remediation epic** — schema migrations to add `org_id` to the ~11 tables above, thread `currentOrgId()` through the ~16 leaking store fns + routes, and a per-surface isolation regression test (the chat test is the template). Fleet-parallelizable; ~1–2 weeks.

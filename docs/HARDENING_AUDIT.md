# Hardening audit — Off Grid Console (2026-07-06)

Read-only, adversarial hardening pass over the whole `console` codebase. Every finding cites
`file:line` from a real read. Severity: **P0** = live exploitable vuln / secret leak, **P1** = real
hole needing a fix, **P2** = weakness / robustness gap. Fix the P0s first.

The console's security spine is largely sound: `requireAdmin`/`requireUser` (`src/lib/authz.ts`),
the canonical attributed audit event (`src/lib/audit-event.ts` + `auditFromSession`,
`src/lib/audit-actor.ts`), the pure `toDisplayHost` IP-masking (`src/lib/display-host.ts`), and the
overview page's `safe()` wrapper (`src/app/(console)/overview/page.tsx:38`) are all good, reusable
patterns. The findings below are the places that *don't* use them.

---

## Severity summary

| Severity | Count |
|----------|-------|
| **P0** | 3 |
| **P1** | 8 |
| **P2** | 9 |
| **Total** | **20** |

## Top 10 (fix in this order)

| # | Sev | File:line | One-liner |
|---|-----|-----------|-----------|
| 1 | P0 | `src/app/api/v1/vectordb/route.ts:32` | Unauthenticated POST → SSRF + arbitrary vector-DB read (any URL + any API key) |
| 2 | P0 | `src/app/api/v1/devices/[id]/audit/route.ts:7` | Unauthenticated audit-event injection → audit-log poisoning |
| 3 | P0 | `src/app/api/v1/admin/access/clients/[id]/secret/route.ts:19` | GET returns raw Keycloak client secret on demand, repeatedly, un-audited |
| 4 | P1 | `src/app/api/v1/admin/access/users/[id]/password/route.ts:21` | Admin password reset via Keycloak — **no audit event** |
| 5 | P1 | `src/app/api/v1/admin/devices/[id]/kill/route.ts:10` | Device kill-switch — **no audit event** |
| 6 | P1 | `src/app/api/v1/admin/erasure/route.ts:15` | GDPR right-to-erasure — **no audit event** |
| 7 | P1 | `src/app/api/v1/admin/policy/push/route.ts:12` | OPA policy push to the live gateway — **no audit event** |
| 8 | P1 | `src/app/api/v1/admin/access/service-clients/provision/route.ts:30` | Machine-credential issuance / rotation into OpenBao — **no audit event** |
| 9 | P1 | `src/lib/store.ts:704` (`listIngestJobs`) | Ingest jobs listed globally, no org filter → cross-tenant leak |
| 10 | P1 | `src/lib/store.ts:721` (`createMaskingRule`) | Masking rule create drops `orgId` → lands in `default` org, invisible to creator |

## Single most urgent thing

**`src/app/api/v1/vectordb/route.ts` — the unauthenticated `POST` (line 32).** It has no
`requireAdmin`/`requireUser` gate, and it takes a caller-supplied `url` + `apiKey` and connects to it,
returning `ping` / `listCollections` / `sample` (raw payload previews). That is simultaneously an
**unauthenticated data-read** of the on-prem vector store (env-default `OFFGRID_QDRANT_URL` +
`OFFGRID_QDRANT_API_KEY` when the body omits them) **and an SSRF primitive** (point it at any internal
host). One curl, no auth. Gate it with `requireAdmin`.

---

## Dimension 1 — Auth on every mutation

Every write route under `src/app/api/v1/admin/**` was grepped for a `requireAdmin`/`requireUser`
gate. **All admin routes are gated** (spot-verified across access/tenants/agents/prompts/governance/
fleet/devices/secrets/policy). The holes are outside `/admin` and on device/data-plane routes.

| Sev | File:line | What's wrong | Fix |
|-----|-----------|--------------|-----|
| **P0** | `src/app/api/v1/vectordb/route.ts:32` | `POST` has NO auth gate. Body supplies `url` + `apiKey`; handler connects and returns collections/sample. Unauthenticated data-read of the on-prem Qdrant (env defaults) + SSRF to any host. | Add `const gate = await requireAdmin(req); if (gate instanceof NextResponse) return gate;` and restrict `url` to an allowlist (or drop the body `url` entirely, use env only). |
| **P0** | `src/app/api/v1/devices/[id]/audit/route.ts:7` | `POST` accepts a batch of audit events for any device id with NO auth (only a `getDevice(id)` existence check). Anyone who knows/guesses a device id can inject forged audit records — poisons the tamper-evidence store. | Verify the device token (`Authorization: Bearer dt_<id>` issued by `enroll`) before `appendAudit`. |
| **P1** | `src/app/api/v1/devices/[id]/commands/route.ts:5`, `.../policy/route.ts`, `src/app/api/v1/devices/route.ts`, `.../enroll/route.ts` | Entire device data-plane is unauthenticated — `commands` GET consumes pending commands (incl. kill), no device-token check. A spoofed device id drains another node's command queue. | Introduce a device-token verifier (mint on enroll, verify on every `/devices/[id]/*` call). Systemic, not per-route. |

Confirmed **not** holes: SCIM routes (`scim/v2/*`) are gated by `scimAuthorized` (a dedicated SCIM
bearer, disabled when `OFFGRID_SCIM_TOKEN` unset — `scim/auth.ts`); `waitlist/route.ts` is
intentionally public (signin page) and is well-hardened (validates email, try/catch, 8s timeout);
`devices/enroll` legitimately uses a one-time enrollment token; provit push routes use
`resolvePushPrincipal` (a `pvt_` token gate).

## Dimension 2 — Audit on privileged actions

The canonical `AuditAction` taxonomy (`src/lib/audit-event.ts:24`) already defines
`access.user.change`, `access.role.change`, `access.machine.issue/rotate`, `policy.change`,
`secret.write`, etc. — but a whole class of **Keycloak-backed and action routes emit no audit event
at all**, while their console-DB twins (`/admin/users/*`, `/admin/roles/*`, `/admin/policy/rules/*`)
do. Every row below is admin-gated (so not a vuln) but leaves **no accountability trail** for a
governed, often destructive, action.

| Sev | File:line | Privileged action, no audit | Fix (mirror connectors/route.ts:39) |
|-----|-----------|------------------------------|--------------------------------------|
| **P0** | `src/app/api/v1/admin/access/clients/[id]/secret/route.ts:19` | GET returns the **raw live Keycloak client secret** and does not audit the read. (POST/regenerate DOES audit — line 35.) A retrievable-anytime plaintext secret + no trail. | Don't return the secret from GET at all (rotate-to-reveal only), or gate + audit each reveal like `config/reveal`. |
| **P1** | `src/app/api/v1/admin/access/users/[id]/password/route.ts:21` | Keycloak password reset. | audit `access.user.change`, resource `user:<id>`. |
| **P1** | `src/app/api/v1/admin/access/users/route.ts:52` / `[id]/route.ts:29,48` | KC user create / update / delete. | audit `access.user.change`. |
| **P1** | `src/app/api/v1/admin/access/service-clients/provision/route.ts:30` | Issues/rotates machine credentials, writes secrets into OpenBao. | audit `access.machine.issue` / `access.machine.rotate`. |
| **P1** | `src/app/api/v1/admin/access/clients/[id]/route.ts:24` (DELETE) / `access/roles/route.ts:22` / `roles/[name]:7` | KC client delete, role create/delete. | audit `access.role.change`. |
| **P1** | `src/app/api/v1/admin/devices/[id]/kill/route.ts:10` | Remote device kill-switch. | audit (add `device.kill` to taxonomy). |
| **P1** | `src/app/api/v1/admin/erasure/route.ts:15` | GDPR/DSAR erasure of a subject's data scope. | audit (add `data.erasure`). |
| **P1** | `src/app/api/v1/admin/policy/push/route.ts:12` | Compiles + PUTs OPA policy bundle to the live gateway. | audit `policy.change`, outcome from push result. |
| **P2** | `src/app/api/v1/admin/fleet/live-query/route.ts:34` | Runs an osquery live query fleet-wide. | audit (add `fleet.livequery`). |
| **P2** | `src/app/api/v1/admin/fleet/policies/route.ts:29` + `[id]:16,44` | Fleet policy CRUD. | audit `policy.change` (or a fleet action). |
| **P2** | `src/app/api/v1/admin/tenants/route.ts:11` + `[id]:5,20` | Tenant create/update/delete. | audit (add `tenant.change`). |
| **P2** | `src/app/api/v1/admin/org-settings/route.ts:13` | Org-wide settings write. | audit (org config change). |
| **P2** | `src/app/api/v1/admin/backups/prune/route.ts:9` | Destructive backup prune. | audit `backup.run`/prune. |

Note: `config/reveal` (`config/reveal/route.ts:18`) writes a bespoke `configAudit` row (`REVEALED`,
never the value) — good, but it bypasses the canonical audit stream; consider unifying so
governance/SIEM sees reveals too.

## Dimension 3 — Graceful degradation when a dependency is down

Central patterns are good and lower most severities: `gatewayFetch` (`src/lib/gateway.ts:44`) is the
gateway seam (note: it does NOT itself catch a connection-refused `fetch` throw — callers must);
`safeListTraces` (langfuse), `readLineageView`/`fetchLineageGraph` (marquez), `readGuardrailsView`
never throw and return `{configured, error}`; the overview page's `safe()` wrapper
(`overview/page.tsx:38`) is the gold standard. A **`src/app/(console)/error.tsx`** boundary exists, so
an unguarded RSC throw shows the console error page rather than a white screen — which is why the page
findings are P2 (whole-page failure, no *partial* degradation) rather than P1 crashes.

| Sev | File:line | What's wrong | Fix |
|-----|-----------|--------------|-----|
| **P2** | `src/app/(console)/(data)/lineage/page.tsx:23` | `listAgentRuns(25, org)` unguarded in a `Promise.all` (the sibling `readLineageView()` IS safe). Postgres down → whole page hits the error boundary. | `listAgentRuns(25, org).catch(() => [])`. |
| **P2** | `src/app/(console)/(build)/agents/[id]/page.tsx:84` | `listAgentRunsByAgent(id, 8)` unguarded — yet the very next call (`listTools`, line 86) already uses `.catch(() => [])`. Inconsistent. | `.catch(() => [])`. |
| **P2** | `src/app/(console)/(build)/agents/[id]/runs/page.tsx:31` | `listAgentRunsByAgent(id, 100)` unguarded. | `.catch(() => [])`. |
| **P2** | `src/app/api/v1/admin/guardrails/recognizers/route.ts:13,22`; `.../recognizers/[id]/route.ts:23,31,40`; `.../guardrails/thresholds/route.ts:14,21`; `.../observability/thresholds/route.ts:11,18`; `.../observability/thresholds/[id]/route.ts:13,22` | Raw Drizzle DB calls with no try/catch in the route. Postgres down → generic 500 (Next catches the throw — not a crash, but an opaque 500 not the `{error}` shape the rest of the API returns). | Wrap in try/catch → `NextResponse.json({ error }, { status: 503 })`. |
| **P2** | `src/app/api/v1/provit/repos/route.ts:41`, `provit/runs/route.ts` | `db.insert(...)` with no try/catch. DB down → 500. | try/catch → 503. |

## Dimension 4 — Raw IP / loopback leak to the client

The `toDisplayHost`/`toDisplayHostname` infrastructure (`src/lib/display-host.ts`) is applied
correctly at every rendered host chip that was checked: `GatewayNodesCard` (~:77), `ServicesDirectory`
(~:65/70), the services page, and `VectorDBInspector` (`:55`). **No P1 leaks found.**

| Sev | File:line | What's wrong | Fix |
|-----|-----------|--------------|-----|
| **P2** | `src/app/(console)/(data)/data/page.tsx:219` | Passes raw `process.env.OFFGRID_QDRANT_URL ?? 'http://127.0.0.1:6333'` as `urlHint` to a client component. Currently safe because `VectorDBInspector` maps it via `toDisplayHost` on first render, so the raw IP never reaches JSX — but it crosses the server→client boundary raw (risk surface). | `toDisplayHost(...)` server-side before passing the prop (defense in depth). |

## Dimension 5 — Secrets discipline

Mostly clean and well-documented. Secret **list/GET** routes return names/metadata only: `secrets`
(`/secrets/route.ts:9-12` — values never returned), `secrets/versions`, `gateway-keys`, and
`config/route.ts:57` (secrets masked to `''`, only `isSet` exposed). Audit redaction is `••••`
(`config.ts:108`). Unseal-key input is shape-validated and never echoed (`secrets-ops.ts:153`).
Dynamic-DB creds returned raw (`secrets/dynamic-db/route.ts:44`) is **correct** — short-lived,
lease-bound, minted on demand, never persisted (documented).

| Sev | File:line | What's wrong | Fix |
|-----|-----------|--------------|-----|
| **P0** | `src/app/api/v1/admin/access/clients/[id]/secret/route.ts:19` | GET returns the **live** Keycloak client secret in plaintext, retrievable at any time by any admin, and un-audited (see Dim 2). This is not a one-time creation reveal — it's a standing secret-retrieval endpoint. | Remove the GET (secret is knowable only via create/rotate, shown once), or require step-up + audit each reveal. |
| **P2** | `src/app/api/v1/admin/access/clients/route.ts:91` | Returns the client secret once at creation. This IS standard OAuth (secret exists only at create/rotate, must be shown once) — acceptable, but ensure it's create-only and audited. | Confirm one-time semantics; add `access.machine.issue` audit. |
| **P2** | `src/app/api/v1/admin/config/reveal/route.ts:26` | Returns a raw config secret value. Properly admin-gated + audited (stores `REVEALED`, not the value) — a defensible break-glass. Consider rate-limiting / step-up for high-risk keys. | Optional: per-key sensitivity + rate limit. |

## Dimension 6 — Input validation on writes

Generally solid — most writes shape the body and 400 on missing fields (connectors, secrets validate
`validateKeyPath`, sandbox validates language + caps timeout at 30s and is double-gated behind the
`agent-code-exec` flag with a no-exec default — `sandbox/run/route.ts`).

| Sev | File:line | What's wrong | Fix |
|-----|-----------|--------------|-----|
| **P1** | `src/app/api/v1/vectordb/route.ts:44` | The `url`/`apiKey` from the body are used to connect with no allowlist — SSRF (also Dim 1). | Restrict `url` host to the known store(s); ignore body `apiKey` (use env). |
| **P2** | `src/app/api/v1/admin/access/users/[id]/password/route.ts:16` | Only checks the password is present — no length/complexity — before forwarding to Keycloak. | Enforce a min policy (Keycloak may also enforce, but validate here for a clean 400). |
| **P2** | `src/app/api/v1/admin/access/clients/route.ts:73` | `body.modules` (role capabilities) passed to `createCustomRole` unvalidated. | Whitelist each capability against the known module set. |
| **P2** | `src/app/api/v1/gateway/tokens/route.ts:72` | `await req.json()` with no `.catch(() => null)` — malformed JSON rejects (Next → 500) instead of a 400. | `.catch(() => null)` + shape check (the rest of the codebase does this). |

## Dimension 7 — Tenant scoping

`connectors` is the reference pattern (passes `await currentOrgId()` to every store call). Most
list/get store fns take an `orgId`. Two real gaps:

| Sev | File:line | What's wrong | Fix |
|-----|-----------|--------------|-----|
| **P1** | `src/lib/store.ts:704` (`listIngestJobs`) | Selects ALL ingest jobs globally — no `orgId` (the `ingestJobs` table has no `orgId` column; jobs belong to org-scoped connectors). Callers `data/page.tsx:46`, `integrations/page.tsx:43`, `admin/ingest-jobs/route.ts:8` expose cross-org ingest metadata. | Add `orgId` to `ingestJobs` (backfill from the connector), filter in the query, pass `currentOrgId()` from callers. |
| **P1** | `src/lib/store.ts:721` (`createMaskingRule`) | Insert omits `orgId`, so it defaults to `'default'` regardless of caller org — while `listMaskingRules(orgId)` (line 715) filters by org, and the route audits with `currentOrgId()`. Net: a non-default org creates a masking rule it can never see, and it silently lands in the `default` tenant. Governance-correctness + cross-tenant confusion. | `createMaskingRule(orgId, kind, action)`, insert `orgId`, pass `await currentOrgId()` from the route (`masking-rules/route.ts:27`). |

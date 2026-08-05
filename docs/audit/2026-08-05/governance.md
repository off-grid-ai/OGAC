# Governance — audit findings

Team: CISO · DPO · Technical operator + Principal UX / UI / Usability / QA / QC.
Scope: `src/app/(console)/governance/**` (36 pages) and the libs + API routes beneath it.
Status: **complete**.

## Section verdict

Governance is the section a CISO and a DPO inspect first, and it is not currently trustworthy for
either: the regulator-facing compliance pack and the provenance ledger both render the **default**
tenant's data on every tenant, two compliance controls are hardcoded green, and the shared policy
bundle plus the unscoped Keycloak user mutations are live cross-tenant escalation paths. The craft
underneath is real — retention, decision logs, access review, egress-DLP and the secrets status model
are honestly built with explicit unreadable-vs-zero handling — which makes these look like org-scoping
and wiring debt rather than missing features. Fix the five tenancy/hardcode blockers and the
"settings that do not reach the engine" claim and the section becomes defensible; until then every
number on it needs a caveat.

---

### [BLOCKER] The compliance posture and the regulator-facing DPIA pack are computed for the *default* tenant, on every tenant
**Persona:** DPO / CISO
**Where:** `src/lib/compliance.ts:68-73` (feeds `/governance/regulatory`, `/governance/trust/regulatory` via `src/app/(console)/governance/regulatory/page.tsx:73`, and the download at `/api/v1/admin/compliance/export`)
**What:** `computeControls()` calls `getOrgPolicy()`, `listMaskingRules()`, `listUsers()`, `listAudit({limit:5000})` with **no orgId**; all default to `DEFAULT_ORG` (`src/lib/store.ts:744`, `:1031`, `:525`). Verified live: `masking_rules` holds `org_suraksha`=8, `org_bharat`=8, `default`=**0**; `audit_events` holds rows for `default` only (20).
**Why it matters:** The insurer tenant's Regulatory page and its downloadable "regulator-ready" pack state **"PII masking (A9) — GAP — 0/0 rules enabled"** while 8 rules are configured and enforcing, and report another tenant's 20 audit events as its evidence. A false negative AND cross-tenant data in a document handed to a regulator.
**Fix:** Thread `currentOrgId()` into `computeCompliance()`/`buildExport()` and pass it to all four store reads.

### [BLOCKER] Two compliance controls are hardcoded `satisfied` and never read the control they claim
**Persona:** CISO / DPO
**Where:** `src/lib/compliance.ts:100-104` (`egress-dlp`), `:118` (`erasure`)
**What:** `ctl('egress-dlp', …, 'satisfied', …)` is a literal — it never reads `getEgressPolicy(orgId)`, so turning cloud egress protection **off** on `/governance/egress` leaves the control green. Its evidence string is also inverted: `policy.egressAllowed === true` renders "cloud egress allowed (leashed)". `erasure` is likewise a literal `satisfied` with evidence "DSAR endpoint available" — endpoint existence, not one erasure record.
**Why it matters:** A badge reflecting existence rather than enforcement, on the one surface whose purpose is proving enforcement. DPDP/GDPR coverage percentages are built on it.
**Fix:** Derive `egress-dlp` from `getEgressPolicy(org)` (`enabled` + `strictness`) and `erasure` from the erasure-request/tombstone store; state "no requests on record" rather than `satisfied`.

### [BLOCKER] The Provenance evidence surface shows the default tenant's signed manifests to every tenant
**Persona:** CISO / auditor
**Where:** `src/lib/provenance-view.ts:98,106` — `readProvenanceView(limit, orgId?)` called with no org at `src/app/(console)/governance/provenance/ProvenanceSurface.tsx:14` and `src/app/api/v1/admin/provenance/route.ts:12`; `listAgentRuns` defaults to `DEFAULT_ORG` (`src/lib/agentrun.ts:514`)
**What:** Live counts: `default` 78 signed / 118 runs, `org_bharat` 136/176, `org_suraksha` 56/77. `/governance/evidence/provenance` renders `default`'s 78 records — with another tenant's agent and run ids in the `subject` column — to all three tenants, and shows none of the viewer's own 56. The Evidence overview card counts the same thing correctly org-scoped but off a different table (`app_runs`, `src/lib/evidence-posture-reader.ts:35`), so the overview and its own detail page disagree.
**Why it matters:** Cross-tenant identifier disclosure on a compliance surface, plus a signed-evidence count wrong in both directions.
**Fix:** Pass `await currentOrgId()` at both call sites; settle on one provenance table for the card and the ledger.

### [BLOCKER] A failed provenance read renders as "0 signed records"
**Persona:** CISO / QC
**Where:** `src/lib/provenance-view.ts:131-133` (`catch { return EMPTY; }`, `EMPTY` at `:40`)
**What:** Any failure — DB down, import failure, signing-key error — yields `{total:0, verified:0, unverified:0, records:[]}`, printed as three zero tiles and an empty ledger.
**Why it matters:** The repo's named worst defect class, on the page that answers "prove these answers are tamper-evident". "Nothing is signed" and "we could not check" are opposite facts. `src/app/(console)/governance/evidence/page.tsx:39-48` gets this right one click earlier, which makes the inconsistency worse.
**Fix:** Return `{ data, error }` as `readSecretsView` does, and render a "could not read this ledger" state.

### [BLOCKER] The org policy bundle is deployment-global, and is labelled "Org egress posture"
**Persona:** CISO
**Where:** `src/lib/store.ts:425-438` (`getOrgPolicy()` — no org parameter; the `policies` table has **no `org_id` column**), write path `src/app/api/v1/admin/policy/route.ts:26-53`, rendered `src/app/(console)/governance/page.tsx:41-49`
**What:** `egressAllowed`, `guardrails` and `allowedModels` are ONE row shared by all three live tenants. Any tenant admin's POST changes the cloud-egress leash, the allowed-model list and the guardrail set for every other tenant; the audit event is filed under the *actor's* org (`:49`) so affected tenants have no record.
**Why it matters:** Cross-tenant privilege escalation on the headline control, presented as "Org egress posture — when leashed, cloud routes are blocked everywhere."
**Fix:** Add `org_id` to `policies`, scope `getOrgPolicy`/`pushPolicy` by `currentOrgId()`, audit into every affected org — or until then gate the write to a platform-operator role and relabel the fact as deployment-wide.

### [BLOCKER] Per-user identity mutations are admin-gated but not tenant-scoped — cross-tenant account takeover
**Persona:** CISO
**Where:** `src/app/api/v1/admin/access/users/[id]/password/route.ts:9-34`, `.../[id]/roles/route.ts:25-49` and `:51-75`, `.../[id]/route.ts:9-59`, plus `/sessions`, `/mfa`, `/required-actions`, `/clients/[id]/secret`
**What:** Each takes a raw Keycloak user id and calls the realm admin behind `requireAdmin(req)` only. `src/lib/user-scope.ts:1-13` documents that the realm is **shared across tenants** and that the LIST is intersected with `users.org_id` — but the detail GET and all mutations skip that check. A tenant-A admin holding a tenant-B user's id can `POST …/password` and take the account over; `GET …/[id]` already discloses that user's profile and realm roles.
**Why it matters:** The tenant-isolation fix was applied to the list and not to the routes that mutate. Privilege escalation, not a display bug.
**Fix:** Extract a shared `requireOrgMember(kcUserId, org)` guard, call it in every `access/users/[id]/**` handler before touching Keycloak, 404 on a non-member.

### [BLOCKER] Guardrail settings pages that do not reach the engine that enforces — and copy that says they do
**Persona:** CISO / usability
**Where:** `src/app/(console)/governance/guardrails/[destination]/page.tsx:96-103` (Thresholds), `:77-82` (Anonymizer operators), claim at `:237-240`; engine `src/lib/adapters/guardrail-provider.ts:262-296`; port list `src/lib/adapters/pii.ts:37`
**What:** `PII_PORTS = [llmGuardPii]` is the only content-guardrail engine (live: `OFFGRID_ADAPTER_GUARDRAILS=llm-guard`), and `llmGuardPii.scan` reads **only** `listGuardrailRules` for scanner suppression — never `getThresholds`, `listRecognizers` or `getAnonymizerPolicy`. Those stores are consumed solely by `src/lib/adapters/presidio.ts:250-256`, reachable only through `getDataRedactionPii` (row-level data movement). Yet the Test panel states: "Custom recognizers, deny lists, and thresholds apply exactly as they do to a real request."
**Why it matters:** An operator sets a confidence floor, sees it saved, and nothing about a governed run changes — while the console asserts the opposite. An unprovable control plus an active false claim.
**Fix:** Either pass thresholds/recognizers/anonymizer policy into the LLM Guard payload, or scope each panel's heading and copy to "data-movement redaction" and delete the claim.

### [MAJOR] Guardrails Overview understates the live detector: "Built-in pattern detection", 4 entity types
**Persona:** CISO
**Where:** `src/app/(console)/governance/guardrails/[destination]/page.tsx:176-187`, `src/lib/guardrails-view.ts:109-113`
**What:** Both branches test `view.engine === 'presidio'`. The live engine is `llm-guard`, so Overview prints "Detection: **Built-in pattern detection**" and `entityTypesFor('llm-guard', remote=true)` returns `[]` + the 4 `IN_*` floor types → "Supported entity types: **4**".
**Why it matters:** The reader concludes the platform detects four PII types with a regex, when the authoritative scanner is what actually runs. The "not configured" badge is also suppressed for this engine, so a misconfigured LLM Guard shows no warning.
**Fix:** Branch on "is the active engine entity-grade" rather than `=== 'presidio'`, and enumerate LLM Guard's entity set.

### [MAJOR] Three governance surfaces are unreachable from any navigation
**Persona:** Technical operator / UX
**Where:** `src/app/(console)/governance/egress/page.tsx`, `.../policies/decision-logs/page.tsx`, `.../policies/bundles/page.tsx`; nav sources `src/modules/contextual-navigation.ts:249-295`, `:363-370`, `src/modules/registry.ts`, `src/modules/ownership.ts`
**What:** None appears in any nav registry or in-app link. The Policies rail instead points at `/governance/policies/decisions`, which falls through `[destination]` to `PolicyDecisions()` reading `readDecisions()` — a DIFFERENT source from the durable, org-scoped, filterable ledger sitting unreachable at `decision-logs`.
**Why it matters:** The egress-DLP leash is described in its own header as mandatory and default-on, and its on/off switch is reachable only by typing the URL. Two decision-log implementations also violate DRY and will disagree.
**Fix:** Add `egress` to the guardrails contextual module; repoint Policies "Decisions" at `decision-logs`; delete or link `bundles`.

### [MAJOR] The guardrail tester puts typed PII into the URL while promising nothing is stored
**Persona:** DPO
**Where:** `src/app/(console)/governance/guardrails/[destination]/page.tsx:227-240`; nav copy `src/lib/guardrails-destinations.ts:36`
**What:** `<form method="GET">` sends the probe as `?q=<text>`. Operators test with real PANs and Aadhaars. The string persists in browser history, the Next/Caddy access log and any upstream request log — under the sentence "Nothing is stored."
**Why it matters:** A privacy surface that itself creates an unlogged-for copy of special-category data, plus a false statement to the user.
**Fix:** POST to a server action (or `router.replace` after the scan); keep the result in the response, not the URL.

### [MAJOR] Creating a user on a non-default tenant produces a user that tenant cannot see
**Persona:** Technical operator
**Where:** `src/app/api/v1/admin/access/users/route.ts:63-83`
**What:** POST calls `kc.createUser` + `kc.assignRoles` and writes **nothing** to the console `users` table. The list at `:30-36` intersects the realm against `orgMemberEmailSet(await listUsers(org))`, so on `org_bharat`/`org_suraksha` the new user is filtered straight out; at sign-in `getUserOrgByEmail` returns null and they land in the default org.
**Why it matters:** The operator sees a 201, then an unchanged list — the classic "it worked but nothing happened" — and the user silently gets the wrong tenant.
**Fix:** Insert the console `users` row with `orgId = currentOrgId()` in the same handler, inside the success path.

### [MAJOR] Engine names, env-var names and component identities leak throughout governance copy
**Persona:** Usability / CISO ("who is OpenBao?")
**Where:** `src/components/secrets/SecretsStatusViews.tsx:26-30` ("Set `OFFGRID_OPENBAO_URL`"), `:42-46` + `src/lib/secrets-view.ts:224` ("OpenBao unreachable at …"), `:56` ("**Vault is sealed**"); `src/app/(console)/governance/access/[id]/page.tsx:49-59` (four lines of `OFFGRID_KEYCLOAK_*` vars and the `realm-management` client role); `src/lib/guardrails-destinations.ts:24` ("for Presidio data-movement redaction"); `src/app/(console)/governance/policies/[destination]/page.tsx:169`
**What:** Rule 5 says users see outcomes, never OSS engine names. Governance is the worst-offending section: the secrets module names the vault product in a red error banner, and the Access empty state hands the reader an env-var checklist — also the "never ask the operator for a component login" anti-pattern.
**Why it matters:** These are exactly the surfaces a buyer's CISO screenshots. "Vault is sealed" is unactionable to anyone who does not already know the deployment.
**Fix:** Route through the existing outcome vocabulary — "The secrets store is locked. Two of three key holders must unlock it before credentials can be read" — and move env-var instructions into operator docs.

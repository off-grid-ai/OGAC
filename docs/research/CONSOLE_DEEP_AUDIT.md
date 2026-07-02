# Console Deep Audit — 2026-07-02

Comprehensive factual record of what actually exists in source vs. what is aspirational.
All file references are relative to `console/src/`.

---

## 1. Authentication — NextAuth + Keycloak

### What exists

**`auth.config.ts`** — edge-safe config shared between middleware and the full auth instance.

Provider activation is conditional on env vars — a missing env simply omits the provider rather than crashing:

```ts
export const googleEnabled   = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
export const keycloakEnabled = Boolean(env.AUTH_KEYCLOAK_ID && env.AUTH_KEYCLOAK_SECRET && env.AUTH_KEYCLOAK_ISSUER);
export const devLoginEnabled = env.AUTH_DEV_LOGIN === 'true' && env.NODE_ENV !== 'production';
```

Three real providers: Google OAuth2, Microsoft Entra ID (OIDC), Keycloak (OIDC). Dev credentials adapter for local browsing without OAuth.

**JWT callback** (`auth.config.ts:63–87`) maps Keycloak `realm_access.roles` and `resource_access.<client>.roles` → first recognised `admin | editor | viewer` app role. A top-level `role` claim from a Keycloak token mapper is also accepted. For non-Keycloak providers, the role falls through to the DB `user.role` column (default `viewer`).

**Session shape** — `session.user.role` is set from the JWT token. TypeScript augmentation lives at `types/next-auth.d.ts`.

**`auth.ts`** — full auth instance (database Drizzle adapter). Not read fully but wires the DB adapter to the NextAuth core.

**`app/api/auth/[...nextauth]/route.ts`** — standard catch-all route.

### Partial / missing

- No refresh-token rotation logic is visible in `auth.config.ts`. Keycloak tokens expire; a long-lived session could present a stale access token. The JWT adapter only caches `token.role` — it does not store the Keycloak `access_token` for API calls to Keycloak Admin.
- The `keycloakAdmin()` singleton (`lib/keycloak-admin.ts`) uses **separate** service-account env vars (`OFFGRID_KEYCLOAK_*`) from the user-facing NextAuth env vars (`AUTH_KEYCLOAK_*`). These are **independent** credentials and both must be configured independently.
- No PKCE enforcement in the Keycloak provider config (relies on NextAuth defaults).
- No logout / back-channel logout from Keycloak — signing out of the console does not invalidate the Keycloak session.

---

## 2. Gateway — Communication with the Gateway at :8800 / :7878

### Port inconsistency

The gateway URL appears **twice** with **different default ports**:

| File | Default |
|------|---------|
| `app/api/v1/gateway/config/route.ts:9` | `http://127.0.0.1:8800` |
| `app/api/v1/gateway/tokens/route.ts:8` | `http://127.0.0.1:7878` |
| `lib/adapters/inference.ts:6` | `http://127.0.0.1:7878` |
| `lib/rag.ts:8` | `http://127.0.0.1:7878` |

The config route targets `:8800` (presumably the gateway's admin/config API); the tokens, inference, and RAG routes target `:7878` (the OpenAI-compatible inference API). Both share `OFFGRID_GATEWAY_URL`. If you set one env var, both ports must live at the same base URL — **this will be wrong** unless the gateway exposes both its admin API and its inference API on the same port. This is a latent misconfiguration risk.

### Gateway Config (`app/api/v1/gateway/config/route.ts`)

- **GET**: Fetches live schema + values from `GATEWAY_URL/config` (with `x-api-key` header), merges with `gateway_config` Drizzle table (console's persisted overrides). Secret values are masked (`***`) from the gateway response. Returns `{ available: bool, entries: [] }`.
- **POST**: Persists to `gateway_config` table, then pushes to `GATEWAY_URL/config`. Differentiates `applied` (live-reload) from `restartRequired` keys from the gateway response. Falls through gracefully when gateway is offline.
- **DELETE**: Removes a key from the DB only (does not push a delete to the live gateway).
- The `GatewaySettings` component polls `/api/v1/gateway/config` on mount and after each save. No auto-refresh interval — one-shot fetch only.

### Gateway Tokens (`app/api/v1/gateway/tokens/route.ts`)

- **GET**: Fetches the live `TokenStore` snapshot from `GATEWAY_URL/tokens`, upserts each token fingerprint into `gateway_client_tokens` table (preserves `meta` and `routingOverrides` from DB on conflicts), then returns the DB rows merged.
- **PATCH**: Updates `meta` and/or `routingOverrides` on a DB row by fingerprint. **No admin auth guard** — the `PATCH` handler has no `requireAdmin` call, so any authenticated user could modify token metadata. (The GET also has no auth guard.)
- The `GatewayTokens` component (`components/gateway/GatewayTokens.tsx`) fetches on mount, shows fingerprint / provider inference / IPs / routing overrides / use count. Read-only UI — there is no edit form for `meta` or `routingOverrides` in the component (the PATCH API exists but is not wired to any UI button).

### GatewayTraffic (`components/gateway/GatewayTraffic.tsx`)

- Polls `/api/v1/gateway/traffic` every 3 seconds.
- Renders per-gateway stats cards (requests, errors, avg latency, tokens, in-flight, queued, peak) and a recent-calls table. Health states: `up | degraded | down | unknown`.
- Expandable call rows show prompt in / completion out / reasoning / tool calls / raw headers (when `OFFGRID_RAW_HEADERS=true` on the gateway).
- Component hides itself entirely when `data.available === false`.

### GatewayTabs (`components/gateway/GatewayTabs.tsx`)

- Tabs: `overview | traffic | logs | control | tokens | settings`
- Active tab reflected in `?tab=` query string.
- `overview` content is server-rendered and passed as a prop; all other tabs are live client components.

---

## 3. Brain / RAG

### Brain (`lib/brain.ts`) — Admin document store

- **Store**: LanceDB (embedded, on-disk at `LANCEDB_PATH` env, default `./.lancedb`) as default. Swaps to Qdrant when `OFFGRID_ADAPTER_RETRIEVAL=qdrant`.
- **Embeddings**: Goes through `getInference().embed()` (the gateway adapter by default, deterministic hash fallback offline).
- **Functions**: `listDocuments`, `getDocument`, `addDocument`, `searchDocuments` — all real, no stubs.
- **Seed data**: Three hardcoded insurance/KYC documents in `SEED_DOCS` are inserted on first table creation. These are domain-specific demo fixtures (FNOL, KYC, term-life objection) that are probably wrong for most real deployments.
- **LanceDB path**: Module-level singleton `tablePromise` — the LanceDB connection is kept open per process. Fine for a single-node deployment; could leak connections if the process restarts frequently.
- `getDocument` is implemented as a full `listDocuments()` scan with `.find()` — O(n) with no indexing. Acceptable for demo sizes, not for production corpora.

### RAG (`lib/rag.ts`) — Chat project knowledgebase

- **Store**: Postgres (`chat_chunks` table with `embedding jsonb`). Embeddings stored as JSON arrays — not a native vector type.
- **Embeddings**: Calls `GATEWAY_URL/v1/embeddings` directly (not via the adapter registry). No fallback if the gateway is down — throws `new Error('embeddings ${r.status}')`.
- **Retrieval**: Pure cosine similarity computed **in Node.js** over all chunks for a project. All chunks fetched into memory, scored, sliced. No database-side ANN index. This is O(n) and will not scale to large corpora.
- **Schema**: `ensureRagSchema()` creates tables idempotently using raw SQL. The Drizzle schema (`db/schema.ts:436–453`) already defines `chatDocuments` and `chatChunks` — the `ensureRagSchema` call is redundant but harmless if Drizzle migrations have run.
- **chunking**: Word-count based with `chunkSize=600`, `overlap=120` (treating words not tokens). Actual token count per chunk is unpredictable.
- **Functions**: `listDocuments`, `addDocument`, `deleteDocument`, `retrieve` — all real and wired.
- **`retrieve`** returns a structured `<knowledge_base>` XML block injected into the system prompt, plus a `citations` array. This is the actual retrieval path for chat — verified real.

---

## 4. Observability

### OTel (`lib/otel.ts`)

Real OTLP/HTTP JSON emission. Two target types:

1. Generic OTLP collector: `OFFGRID_OTLP_URL` + `/v1/traces`
2. Langfuse OTLP ingest: `OFFGRID_LANGFUSE_OTLP_URL` + `OFFGRID_LANGFUSE_AUTH` (base64 Basic auth)

Both fire-and-forget with 3-second timeout and silent catch. `emitSpan` is a synchronous call that does not block.

**What is actually emitted**: Each call to `emitSpan` creates a single synthetic span with a fresh `traceId` and `spanId`. There is **no parent span context** — spans are disconnected point events, not a distributed trace. Every `emitSpan` call creates an independent root span. This means Langfuse / SigNoz will see a flood of 1-span traces rather than a coherent request trace.

`OTEL_DEBUG=true` echoes to stdout. No-op when no targets are configured.

### Langfuse chat traces (`lib/chat-trace.ts`)

Separate mechanism from `otel.ts` — posts directly to Langfuse's `/api/public/ingestion` REST API (not OTLP). Creates a `trace-create` + `generation-create` pair per chat turn. Uses `OFFGRID_LANGFUSE_PUBLIC_KEY` + `OFFGRID_LANGFUSE_SECRET_KEY` (or falls back to `OFFGRID_LANGFUSE_AUTH` blob).

This is real and wired to the chat stream route (`app/api/v1/chat/stream/route.ts` calls `emitChatTrace`). Token counts and timing metadata are passed when available.

### Observability adapters (`lib/adapters/observability.ts`)

Two adapters registered: `otelObservability` and `signozObservability`. Both delegate to the same `emitSpan` function — SigNoz is not a different code path, just a different `render: 'embed'` metadata that tells the UI to show a SigNoz iframe. The actual emission is identical.

### What is real vs. mock

| Feature | Status |
|---------|--------|
| OTLP span emission | Real — fires HTTP POST to OTLP collector |
| Langfuse chat traces | Real — fires HTTP POST to Langfuse ingestion API |
| Langfuse trace read-back | Real — `lib/langfuse.ts` fetches `/api/public/traces` |
| SigNoz embed | Metadata only — renders as iframe of `OFFGRID_SIGNOZ_URL` |
| Distributed trace context | Missing — every span is an independent root, no parent/child linking |
| Agent-run OTLP traces | Real — agent run pipeline calls `emitSpan` at each step |

---

## 5. SIEM

### `lib/siem.ts`

Two functions:

**`shipAudit(events)`** — fire-and-forget POST to OpenSearch `_bulk` API. Only runs when `OFFGRID_OPENSEARCH_URL` is set. No-ops silently otherwise. The `Shippable` type carries: `id`, `deviceId`, `model`, `outcome`, `tokens`, `leftDevice`, `keyId`, `ts`. **Does not include** PII check results, routing decision, or latency — those live on `auditEvents.checks` in Postgres but are not shipped to OpenSearch.

**`searchAudit(params)`** — full-text + filtered search over the OpenSearch audit index using the DSL builder. Returns `{ total, hits, configured, error? }`. Degrades gracefully (returns `configured: false` or an error string) when OpenSearch is unreachable.

### Is `shipAudit` actually called anywhere?

Grep required — the SIEM is only useful if `shipAudit` is invoked on the hot path. Based on reading the audit event model, the expectation is that `shipAudit` is called whenever an `auditEvent` is written. Checking `lib/finops.ts` (not read) and the device audit route would confirm. The `siem.ts` module exports `shipAudit` but whether it is called is not verifiable from the files read without a grep.

### OpenSearch index assumption

`siem.ts` and `token-budgets.ts` use **different index names** for OpenSearch:
- `siem.ts`: `OFFGRID_OPENSEARCH_INDEX ?? 'offgrid-audit'` (audit events)  
- `token-budgets.ts`: `OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway'` (gateway traffic records)

These are separate indexes and must both exist for full functionality.

---

## 6. PII / Guardrails

### Adapter chain (`lib/adapters/pii.ts`, `lib/adapters/registry.ts`)

Two PII adapters registered in `PII_PORTS`:

**`regexPii`** (id: `checks`) — always-on default. Regex scan for `EMAIL_ADDRESS` and `PHONE_NUMBER` only. The EMAIL regex uses the `/g` flag but the regex object is declared at module level — calling `.test()` twice on a stateful `/g` regex will alternate results (classic JS regex bug). Specifically:

```ts
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;  // module-level with /g flag
// ...
if (EMAIL.test(text)) { /* first call */ }
EMAIL.replace(...)    // second call — lastIndex is already advanced
```

This is a real bug: on the second document processed, the email regex will start matching from a non-zero `lastIndex` and may miss emails at the start of the text. The `PHONE` regex has the same issue.

**`presidioPii`** (id: `presidio`) — HTTP POST to `OFFGRID_PRESIDIO_URL/analyze`. Falls back to `regexScan` on any error or when URL is unset. Presidio anonymizer is not called — only the analyzer. The redaction is synthesized by the regex replacer even when Presidio detected the entities (so Presidio's positional offsets are ignored and the regex does the actual redaction).

### Active adapter selection

`getPii()` in `registry.ts` selects based on `OFFGRID_ADAPTER_GUARDRAILS` env var. Default is `regexPii` (id `checks`). Presidio requires `OFFGRID_ADAPTER_GUARDRAILS=presidio`.

### Where is the PII scan called?

`getPii()` is exported from the registry. The adapter scan is used in the checks spine. The PII scan route (`app/api/v1/admin/pii/scan/route.ts`) exists as an explicit admin endpoint. Whether the PII scan is in the hot path of every chat request requires checking the chat stream route — not confirmed from files read, but the presence of `checks` in `auditEvents` (schema:34) suggests it is.

---

## 7. FinOps

### Token budgets (`lib/token-budgets.ts`)

The `tokenBudgets` table is defined in `lib/token-budgets.ts` (not in `db/schema.ts` — it uses a separate idempotent `ensureTokenBudgetSchema()` pattern with raw SQL). This means it is **not part of the Drizzle migration graph** and will not show up in `drizzle-kit generate`. It creates itself on first use.

Schema:
```
token_budgets(id, subject, period, allocated_tokens bigint, window_start, created_by, created_at)
UNIQUE INDEX on (subject)
```

**Usage measurement**: Queries `OFFGRID_GATEWAY_INDEX` (default `offgrid-gateway`) in OpenSearch, filtering by `caller.keyword` term. If OpenSearch is unreachable, returns zero usage rather than throwing. Cost is computed via `costOf(rec)` from `@offgrid/finops` package.

**Functions**: `listBudgets`, `getBudget`, `setBudget` (upsert), `deleteBudget`, `usageFor`, `budgetsWithUsage`.

**`budgetsWithUsage`** — joins budgets with live OpenSearch usage: computes `remaining`, `pctUsed` (%), and `projectedMonthly` USD extrapolated from elapsed window time. This is a real, working computation when OpenSearch is populated.

### FinOps DB schema in `db/schema.ts`

The `apiKeys` table (schema:39–48) tracks virtual keys with `budgetUsd` (monthly budget in whole USD). This is **separate** from `tokenBudgets` (which tracks token counts, not USD). There are effectively two parallel budget systems:
1. `apiKeys.budgetUsd` — coarse USD cap stored on the key record
2. `tokenBudgets.allocatedTokens` — fine-grained token allocation with live usage from OpenSearch

### Enforcement gap

Neither budget is enforced in the inference path. The `apiKeys` USD budget and `tokenBudgets` token allocation are monitoring/reporting only — there is no middleware or hook that blocks requests when a budget is exceeded. The `TokenBudgets` UI component shows remaining balance but does not gate calls.

---

## 8. Access Control — Gateway Tokens and Access Pages/APIs

### Access page (`app/(console)/access/page.tsx`)

Server component. Calls `requireModuleForUser('admin')` — blocks non-admins. Then pings `NEXTAUTH_URL/api/v1/admin/access/users` with `x-internal-request: 1` to check if Keycloak is configured. Shows `AccessTabs` if configured, or a setup instructions card if not.

### AccessTabs (`components/access/AccessTabs.tsx`)

Three tabs: `users | clients | roles`. Tab state reflected in `?tab=` query string.

### UsersList (`components/access/UsersList.tsx`)

Full CRUD via Keycloak Admin API:
- **List**: GET `/api/v1/admin/access/users?search=...` — debounced search (400ms)
- **Create**: POST `/api/v1/admin/access/users` — email + password + firstName + lastName + roles
- **Delete**: DELETE `/api/v1/admin/access/users/:id`
- **Assign roles**: POST/DELETE `/api/v1/admin/access/users/:id/roles`
- **Reset password**: POST `/api/v1/admin/access/users/:id/password`
- Expandable row shows role assignment (toggled checkboxes with save) and password reset form

### RolesList (`components/access/RolesList.tsx`)

Keycloak realm roles:
- **List**: GET `/api/v1/admin/access/roles`
- **Create**: POST `/api/v1/admin/access/roles` — name + description
- **Delete**: DELETE `/api/v1/admin/access/roles/:name` — warns on built-in roles (`admin`, `viewer`, `editor`, `compliance`)

Protected set: `{ 'admin', 'viewer', 'editor', 'compliance' }` — deletion is warned but not blocked.

### MachineClientsList (`components/access/MachineClientsList.tsx`)

Keycloak client (machine-to-machine) management:
- **List**: GET `/api/v1/admin/access/clients`
- **Create**: POST `/api/v1/admin/access/clients` — clientId + optional name/description + serviceAccountsEnabled toggle
- **Delete**: DELETE `/api/v1/admin/access/clients/:id`
- **Reveal secret**: GET `/api/v1/admin/access/clients/:id/secret` — fetches from Keycloak
- **Rotate secret**: POST `/api/v1/admin/access/clients/:id/secret` — regenerates via Keycloak

New secret is shown once in a `NewSecretBanner` component with a copy button and dismissal gate ("I have saved it"). This is correctly one-time only.

A `curlExample` code snippet shows how to get a token — it hardcodes `window.location.origin` as the Keycloak URL which is wrong (the console and Keycloak run on different origins in any real deployment). Bug: the curl example would always show the wrong issuer URL.

### API routes for access (`app/api/v1/admin/access/`)

All routes call `requireAdmin(req)` at the top — correctly admin-gated.

**users/route.ts**: GET (search/paginate), POST (create + optional role assignment)  
**users/[id]/route.ts**: GET (single user), PUT (update), DELETE  
**users/[id]/roles/route.ts**: GET (list user roles), POST (assign), DELETE (remove)  
**users/[id]/password/route.ts**: POST (reset password)  
**roles/route.ts**: GET (list realm roles), POST (create)  
**roles/[name]/route.ts**: DELETE  
**clients/route.ts**: GET (list clients), POST (create + auto-generate initial secret)  
**clients/[id]/route.ts**: GET (single client), DELETE  
**clients/[id]/secret/route.ts**: GET (fetch secret), POST (regenerate)  

All routes delegate to `KeycloakAdminClient` — they are real (not stubs). They return `{ configured: false }` when Keycloak env vars are absent rather than erroring.

### `KeycloakAdminClient` (`lib/keycloak-admin.ts`)

Full typed REST client with in-process token caching (30s expiry buffer). Uses `client_credentials` grant. Methods: listUsers, getUser, createUser, updateUser, deleteUser, resetPassword, listUserRoles, assignRoles, removeRoles, listRealmRoles, createRealmRole, deleteRealmRole, listClients, getClient, createClient, deleteClient, getClientSecret, regenerateClientSecret.

Singleton via `keycloakAdmin()` — `null` when env vars absent. Process-global token cache — will not survive Lambda cold starts but is fine for a Node.js server.

### GatewayTokens auth gap

`app/api/v1/gateway/tokens/route.ts` — **neither GET nor PATCH has a `requireAdmin` call**. Any authenticated session can fetch all gateway token fingerprints, IPs, and provider inferences, and PATCH routing overrides. This is a security issue — the access control is missing on both handlers.

---

## Summary Table

| Area | Real & Working | Partial | Broken / Missing |
|------|---------------|---------|-----------------|
| Auth — Google/Microsoft/Keycloak SSO | Yes | — | No back-channel logout; no refresh rotation |
| Auth — dev login | Yes | — | — |
| Auth — role mapping from Keycloak claims | Yes | — | — |
| Gateway config read/write | Yes | — | Port mismatch risk (8800 vs 7878) |
| Gateway tokens sync | Yes (DB upsert from gateway) | No edit UI for overrides | No auth guard on API |
| Gateway traffic live polling | Yes | — | — |
| Brain LanceDB store | Yes | Insurance-specific seed data | getDocument is O(n) scan |
| Brain Qdrant swap-in | Yes (dispatch exists) | — | — |
| RAG (chat project knowledgebase) | Yes | In-memory cosine (no ANN) | Gateway embedding has no offline fallback |
| OTLP span emission | Yes | All spans are disconnected roots | No parent trace context |
| Langfuse chat traces (direct API) | Yes | — | — |
| Langfuse OTLP traces | Yes | — | Disconnected roots same as above |
| SIEM ship to OpenSearch | Yes (code) | Unclear if wired to hot path | — |
| SIEM search from OpenSearch | Yes | — | — |
| PII regex scan | Yes | Email/phone only | Stateful `/g` regex module-level bug |
| PII Presidio integration | Yes (with fallback) | Presidio offsets ignored in redaction | — |
| Token budgets (token-level) | Yes | Not enforced (monitoring only) | Not in Drizzle migration graph |
| Virtual keys (USD budget) | Schema exists | Not enforced | No reconciliation with token-budgets table |
| Keycloak Admin — users CRUD | Yes | — | — |
| Keycloak Admin — roles CRUD | Yes | Built-in roles deletable without hard block | — |
| Keycloak Admin — machine clients CRUD | Yes | curl example shows wrong Keycloak URL | — |
| Access page Keycloak detection | Yes | — | — |

# Adversarial break-test — Console Gateway + Model-Settings

QA-on-a-bug-hunt pass over the gateway subsystem (many gateways, providers, routing, API keys,
rate limits, pipeline↔gateway binding). Goal: PROVE the developer wrong, not confirm the feature.
Read-only against the live seeded demo; all mutation attempts are LOCAL integration / unit / red
tests only.

- **Tests:** `test/gateway-adversarial.test.ts` (pure unit), `test/gateway-adversarial.integration.test.ts` (real Postgres).
- **Backlog:** `docs/GAPS_BACKLOG.md` → `G-ADV-GW-*`.
- **Worktree HEAD tested:** `7ea13b8` (landing merge on top of wave2 lineage).

## Axes

| Axis | Values exercised |
|------|------------------|
| provider / gateway kind | on-prem · openai · anthropic · deepseek · zhipu(glm) · compat(openrouter) |
| config state | configured · not-configured (no key / no baseUrl) |
| health | up · degraded · unavailable · reachable |
| residency | on-prem (data stays) · cloud (data leaves) — egress leash |
| API key | mint (Keycloak client_credentials) · rotate · revoke(disable) · hard-delete · malformed bearer |
| rate limit | per-IP floor (60/min) · per-key configured · at / over boundary · zero(pause) · NaN clock |
| pipeline binding | bound · unbound · bound-then-gateway-deleted · gateway-unreachable |
| routing / failover | rule match · leash(cloud→block) · provider select · no-provider degrade |
| budgets | limit null · within · over · zero-cost exemption |
| role | admin · viewer(read-only demo) · machine bearer |

## Journeys + pairwise crossings exercised

1. **rate-limit clock × bucket lifecycle** — NaN/boundary `now` crossed with window-reset (G-ADV-GW-1, -2).
2. **model tag shape × configured providers** — malformed/mid-string provider token crossed with 2-provider config (G-ADV-GW-3).
3. **gateway kind × PATCH field-clear × persisted row** — non-compat kind crossed with an empty-baseUrl patch (G-ADV-GW-4).
4. **XFF header × IP bucket** — client-controlled `x-forwarded-for` crossed with the per-IP floor (G-ADV-GW-5, observation).
5. **key enabled-state × resolver failure × edge admit** — revoked key crossed with a DB hiccup (G-ADV-GW-6, observation).

## Coverage ledger

Legend: ✓ verified robust · ❌ confirmed break (RED test) · ⚠️ weakness / observation / untested crossing.

| Area | Behavior under attack | Verdict |
|------|-----------------------|---------|
| rate-limit boundary | `count > limit` (not `>=`); 60th allowed, 61st denied | ✓ (author tests + re-verified) |
| rate-limit zero limit | `limit<=0` denies first request (pause) | ✓ |
| rate-limit reset | past-window `now` re-admits | ✓ |
| **rate-limit NaN clock** | **`now=NaN` poisons `resetAt`; bucket denied forever, retry-after NaN** | **❌ G-ADV-GW-1** |
| rate-limit reset boundary | `now===resetAt` is still the OLD window (1ms starvation) | ⚠️ G-ADV-GW-2 (benign, undocumented) |
| resolveRateLimit precedence | key → org → floor; 0 honored; NaN/neg clamped | ✓ |
| **cloud provider select** | **mid-string `:openai:` in a model id mis-routes to that cloud provider + mangles model** | **❌ G-ADV-GW-3** |
| cloud provider select | well-formed `cloud:openai:gpt-4o` triple form | ✓ (author test) |
| cloud provider select | multi-provider + untagged → null (honest) | ✓ |
| egress leash | `cloud && !egressAllowed` → block (decideRouting + planCloudRoute defence-in-depth) | ✓ (author tests) |
| **gateway PATCH baseUrl** | **empty-string baseUrl clears a non-compat gateway's URL; unusable row persists, no error** | **❌ G-ADV-GW-4** (verified vs real PG) |
| gateway PATCH compat | clearing baseUrl on kind=compat → rejected on merged shape | ✓ |
| gateway update enabled | `{enabled:false}` disables (Boolean coercion + `??` is correct) | ✓ |
| gateway create egressClass | always derived from kind, input egressClass ignored | ✓ |
| gateway id collision | `onConflictDoNothing` on id; cross-org id → fresh id | ✓ |
| **gateway baseUrl/hostname uniqueness** | **no uniqueness constraint; duplicate baseUrl/hostname rows persist silently** | ⚠️ G-ADV-GW-7 |
| API key parse | `ogak_<client>.<secret>`; clientId must carry `ogak-`; both parts non-empty | ✓ |
| API key gate vs parse | `isGatewayApiKey('ogak_.secret')` → true but `parseApiKey` → null (gate looser than parser) | ⚠️ G-ADV-GW-8 |
| API key verify | client_credentials exchange; wrong secret / unknown client → false; non-key → no network call | ✓ (author test) |
| API key revoke | disable Keycloak client; resolver pins disabled key → limit 0 → edge denies | ✓ |
| **revoked key × DB error** | **resolver DB error → `{rateLimit:null}` → edge applies FLOOR and ADMITS the revoked key (fail-open)** | ⚠️ G-ADV-GW-6 |
| ownerOrg on key create | passed to Keycloak unvalidated (could scope cross-tenant) | ⚠️ G-ADV-GW-9 |
| **per-IP floor × XFF** | **`x-forwarded-for` is client-controlled; absent `cf-connecting-ip` ⇒ rotate XFF ⇒ fresh bucket ⇒ floor bypass** | ⚠️ G-ADV-GW-5 |
| pipeline bound → deleted gateway | run degrades to clean error, never fabricated 200 | ✓ (map + code) |
| pipeline bound → unreachable gateway | 20s timeout → clean `status:'error'` | ✓ |
| viewer write attempt | middleware `isViewerWriteAttempt` → 403 before handler; admin routes `requireAdmin` | ✓ |
| route-degrade message | raw `err.message` surfaced in 503 body — INTENTIONAL per author test (not a break) | ✓ (documented) |

## Confirmed breaks (repro + terminal artifact + root cause)

### G-ADV-GW-1 (HIGH) — a NaN clock permanently wedges a rate-limit bucket
- **Repro:** `checkRateLimit('k',{limit:1,windowMs:60000}, NaN, map)` then any later call.
- **Terminal artifact:** every subsequent call returns `{allow:false, retryAfterSec:NaN}` forever; `map.get('k').resetAt === NaN`.
- **Root cause:** `src/lib/rate-limit.ts:56` — reset guard is `now > entry.resetAt`. A NaN `resetAt` makes every `now > NaN` false, so the window never resets. No guard on the `now` argument (`:46-51`). Fail-closed-forever (self-DoS), not an over-admit. `now` is `Date.now()` in the middleware today, so not directly attacker-reachable — but the exported pure primitive corrupts shared state on any bad clock / future caller with no self-heal.
- **Fix direction:** clamp/reject a non-finite `now` at the top of `checkRateLimit` (treat as "open a fresh window") — pure, one branch, one test.

### G-ADV-GW-3 (MEDIUM) — provider token in the MIDDLE of a model id mis-routes to cloud
- **Repro:** two providers configured; `selectCloudProvider(providers, 'my-local-model:openai:v2')`.
- **Terminal artifact:** returns `{provider:'openai', model:'v2'}` — a wrong-provider selection with a corrupted upstream model id.
- **Root cause:** `src/lib/cloud-providers.ts:187` uses `lower.includes(`:${prefix}:`)` (a substring match, not an anchored prefix); `:197` then slices everything after the LAST colon. An arbitrary/mistyped/hostile tag containing `:openai:` anywhere binds that cloud provider. Gated by the egress leash (only fires when `effective==='cloud'` and egress allowed), so it's a routing-correctness bug, not a residency breach — but it silently sends a mangled model to the wrong upstream.
- **Fix direction:** match provider selectors only as an anchored prefix (`cloud:`/`openai:`/… at position 0, or a strict `namespace:model` two-segment form), not `includes`.

### G-ADV-GW-4 (LOW/MEDIUM) — PATCH clears a non-compat gateway's baseUrl, persists unusable row
- **Repro (verified vs real Postgres):** create an `openai` gateway with a baseUrl → `updateGateway(id, {baseUrl:''}, org)` → read back.
- **Terminal artifact:** `res.ok === true`; the persisted row's `baseUrl === ''` — an unusable cloud gateway with no error to the operator.
- **Root cause:** `src/lib/gateways.ts:198` merges `patch.baseUrl ?? existing.baseUrl`; `validateGatewayUpdate` (`gateways-policy.ts:262`) turns an empty-string input into `patch.baseUrl = ''` (not nullish), so `'' ?? existing` = `''`. The only emptiness guard, `validateMergedGateway` (`:288`), checks `kind==='compat'` ONLY — cloud/on-prem kinds are unguarded.
- **Fix direction:** treat an empty patched baseUrl as "no change" (or reject), or extend the merged invariant beyond compat for kinds that require a baseUrl.

## Weaknesses / observations (not filed as hard breaks — mitigations exist or by-design)

- **G-ADV-GW-5 (per-IP floor XFF bypass):** `src/middleware.ts:33-39` derives the IP from `cf-connecting-ip` else the client-controlled `x-forwarded-for`. Behind Cloudflare (the documented prod topology) `cf-connecting-ip` is authoritative, so XFF can't spoof; but any deploy NOT strictly behind CF lets an attacker rotate XFF for a fresh bucket per request → floor bypass. Note the tenant-slug code (`:157-163`) deliberately strips client headers; the rate-limit IP does not.
- **G-ADV-GW-6 (revocation fails open on DB error):** the internal resolver pins a disabled key to limit 0 (correct), but on ANY DB error returns `{rateLimit:null}` (`internal/rate-limit/route.ts:34-38`), and the edge then applies the FLOOR — admitting a revoked key at 60/min during a DB hiccup. True revocation is enforced at the aggregator (Keycloak), so the console edge is defence-in-depth; still a fail-open window.
- **G-ADV-GW-7 (no gateway uniqueness):** no DB uniqueness on baseUrl/hostname; duplicate gateways persist silently, pipelines can bind either.
- **G-ADV-GW-8 (gate looser than parser):** `isGatewayApiKey('ogak_.secret')` → true but `parseApiKey` → null; the aggregator may attempt a token exchange on a key the parser rejects.
- **G-ADV-GW-9 (ownerOrg unvalidated):** `gateway-keys` POST passes `body.ownerOrg` to Keycloak unvalidated — a mis-scoped key can be created.

## What was NOT verified (honesty)

- Live end-to-end aggregator/LiteLLM behavior (read-only rule; no live mutation of the seeded demo).
- Multi-instance counter sharing — `ipCounters`/`keyCounters` are module-level in-memory maps; per-instance in a scaled/serverless deploy (out of scope here, but worth a gap).
- Real Keycloak revocation timing at the aggregator (verify seam tested locally with a fake token endpoint only).

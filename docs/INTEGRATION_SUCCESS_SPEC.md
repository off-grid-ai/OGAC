# Integration success spec — what "comprehensively done" actually means

**Why this exists.** Phase 4 was marked "largely complete" and it was false — because there were no
acceptance criteria, so "done" was just a claim. This document makes integration success
**falsifiable**: every criterion is a concrete, checkable test, and each is tracked across three gates.
**Nothing is "done" until it passes the VERIFIED gate.** Unit tests passing ≠ integration working.

## The three gates (a criterion is DONE only at gate 3)

| Gate | Meaning | Evidence required |
|---|---|---|
| **1. CODE** | Logic exists, merged to main, typecheck + unit tests green | commit + `npm test` |
| **2. WIRED** | Deployed to the server, env/secrets set, service reachable | `.env` keys present + service health 200 |
| **3. VERIFIED** | An end-to-end probe against the LIVE system passes | the probe command below returns PASS |

> **Current reality (2026-07-05): every item below is at GATE 1 only.** Code is merged and unit-tested;
> nothing is deployed, so nothing is WIRED or VERIFIED. Do NOT report integration as working until the
> probes pass. This is the whole point of the doc.

---

## Part A — Unified identity (Phase 4.10)

**Definition of comprehensive success:** one Keycloak credential works everywhere; no static keys or
anonymous access remain; every no-auth image is unreachable except from the console; cross-service
calls carry a per-service credential minted from Keycloak and held in OpenBao.

| # | Acceptance criterion (VERIFIED-gate test) | Code | Wired | Verified |
|---|---|:--:|:--:|:--:|
| A1 | `getServiceCredential('gateway')` returns a real Keycloak JWT (not the static key) and the aggregator accepts it: `curl` the aggregator with that Bearer → 200; with a garbage Bearer → 401. | ✅ | ❌ | ❌ |
| A2 | Each of the 5 service clients exists in Keycloak and a `client_credentials` grant returns a token whose `aud` = the service. Probe: token endpoint × 5 → decode `aud`. | ✅ | ❌ | ❌ |
| A3 | Each service secret is readable at `secret/<svc>/client-secret` in OpenBao (and NOT in any committed env). Probe: OpenBao GET × 5 → 200. | ✅ | ❌ | ❌ |
| A4 | Presidio/Marquez/OPA are NOT reachable from another LAN host (only from the console host). Probe: from a non-S1 box, `curl offgrid-s1.local:9200/:8181/:9000` → connection refused/timeout; from S1 → 200. | ✅ | ❌ | ❌ |
| A5 | A machine client (service-account JWT) can call `/api/v1/*` and is authorized by ABAC; a user session can too; both hit the SAME downstream via the console. Probe: same endpoint with a Keycloak SA token and with a session cookie → both 200, unauth → 401. | ✅ | ❌ | ❌ |
| A6 | No adapter uses a hard-coded static key/anon access after Phase B. Probe: `grep` for `x-api-key`/anon-S3/env-project-keys in adapters returns only the legacy fallback branch, never the primary path. | ❌ (Phase B) | ❌ | ❌ |
| A7 | Revocation works: invalidate a service credential in OpenBao → the next downstream call fails closed (not a stale cached token indefinitely). Probe: rotate secret, force refresh, old token rejected. | ✅ | ❌ | ❌ |

## Part B — Console as the integration bus

**Definition:** when services need each other, the call goes through the console's authenticated
handler (verify token → ABAC → downstream with a stored credential), never ad-hoc service-to-service.

| # | Acceptance criterion | Code | Wired | Verified |
|---|---|:--:|:--:|:--:|
| B1 | Every downstream call in the adapters authenticates via `getServiceCredential()` (one seam), not per-adapter hard-coded auth. | ⚠️ broker exists; adapters not yet swapped (Phase B) | ❌ | ❌ |
| B2 | No service is directly reachable by an end user bypassing the console (edge/network boundary). Covered by A4 + the Caddy exposure analysis. | ✅ | ❌ | ❌ |
| B3 | A downstream 401 (expired service token) triggers one transparent refresh + retry, not a user-facing error. Probe: force-expire, call, observe single refresh. | ✅ (invalidate hook) | ❌ | ❌ |

## Part C — Cross-service composition (services work *together*, not just individually)

**Definition:** one governed run chains the pipeline and fans out to the observability planes, all
correlated by a single run id. This is the real "integrated platform" test.

| # | Acceptance criterion (the money test) | Code | Wired | Verified |
|---|---|:--:|:--:|:--:|
| C1 | A single agent/chat run executes policy → guardrails → retrieval → gateway → grounding → provenance in order, and the run trace shows every stage. Probe: run one, `GET /agent-runs/<id>` shows all stages. | ✅ | ❌ | ❌ |
| C2 | That run's id appears, correlated, in ALL of: the OpenSearch audit index, a Langfuse trace, a Marquez lineage event, and a signed provenance record. Probe: one run id → 4 lookups → all 4 hit. | ⚠️ each emitter exists; correlation-by-run-id NOT proven | ❌ | ❌ |
| C3 | A PII prompt is caught by Guardrails (Presidio), blocked/redacted per Policy (routing rule), and the block is visible in SIEM + provenance. Probe: send PII → blocked → appears in audit + SIEM. | ⚠️ | ❌ | ❌ |
| C4 | A durable (Temporal) run carries the SAME identity + policy context as an inline run and produces the same audit/trace/lineage/provenance fan-out. Probe: run via worker, compare fan-out to C2. | ❌ (identity-in-activity not built) | ❌ | ❌ |

---

## The verification harness (how we prove it — not by claiming)

Success is measured by a **runnable probe script**, not by review. The harness is
**`deploy/verify-integration.sh`** (a sibling to `deploy/prod.sh verify`). It runs against the live
server and prints one line per criterion — `PASS <id>`, `FAIL <id>`, or `SKIP <id>` — then a tally.
Until it runs clean on the live box, integration status is "GATE 1 — code only."

### How to run it

It is meant to run **ON S1** (`127.0.0.1`), where every backend is reachable over loopback and the
creds live in the console's `.env.local` (which the script sources — nothing is hardcoded):

```bash
ssh admin@127.0.0.1
cd /Users/admin/offgrid/console
./deploy/verify-integration.sh
# override env file / console base if needed:
OFFGRID_ENV_FILE=/path/.env.production CONSOLE_BASE=http://127.0.0.1:3000 ./deploy/verify-integration.sh
```

From a dev Mac (bonus — the backends bind to S1 loopback, so it still executes on S1):

```bash
ssh -t admin@offgrid-s1 'cd /Users/admin/offgrid/console && ./deploy/verify-integration.sh'
```

### What each result means

- **PASS** — an end-to-end probe against the live system succeeded (the VERIFIED gate for that id).
- **FAIL** — a *deployed* thing is broken. The script exits **non-zero** if any check FAILs.
- **SKIP** — a precondition isn't met (service not deployed, secret not provisioned, tool missing, or
  an S1-only limitation). SKIP does **not** fail the run — it is the honest "NOT-VERIFIED yet" state,
  never a false PASS and never a misleading FAIL.

### Coverage (check id → probe)

| id | Probe |
|---|---|
| **A1** | Aggregator (`:8800`): a minted gateway JWT (or the static key fallback) → 200; a garbage bearer → 401. |
| **A2** | For each of the 5 clients: OpenBao secret → Keycloak `client_credentials` grant → decode JWT `aud` == `offgrid-<svc>`. |
| **A3** | OpenBao GET `secret/<svc>/client-secret` × 5 → value present. |
| **A4** | **Bind-check only on S1** (loopback is always reachable from S1): assert `:9200/:8181/:9000` bind to `127.0.0.1`, not `0.0.0.0`. The true external-unreachability test **must run from a non-S1 host** (`curl offgrid-s1.local:9200 → refused`). |
| **A5** | A machine bearer (SA JWT, or `OFFGRID_ADMIN_TOKEN` fallback) → 200 and unauth → 401 on `/api/v1/admin/agents`. (Session-cookie parity is a browser test, noted not covered.) |
| **A7** | **Manual** — destructive rotate-and-reject; SKIP-by-design so the harness never mutates a live secret. |
| **B2** | Derived from A4 + the Caddy exposure analysis; SKIP on S1 (real proof is A4 from a non-S1 host). |
| **B3** | **Manual** — needs a forced token expiry to observe the single transparent re-mint; SKIP-by-design. |
| **C1** | POST one **labelled** governed run (`"integration-verify probe …"`), GET it, assert stages `policy·guard·ground·sign` (a `denied`/`blocked` short-circuit is a valid governed outcome). |
| **C2** | *The money test.* That run id, correlated across **all 4** planes: OpenSearch `offgrid-audit`, a Langfuse trace (`traceId = runId` with non-alphanumerics stripped), a Marquez lineage event (`run.runId`, namespace `offgrid-console`), and the embedded provenance record. All 4 hit → PASS; fewer → SKIP (NOT-VERIFIED). **Today the audit index is keyed by device/gateway events, not the agent runId — so full correlation is the flagged gap and reads as SKIP, not a false PASS.** |
| **C3** | POST a labelled PII prompt → expect a guard/policy block. SKIP when Presidio isn't edge-wired yet (Guardrails on the regex floor). |
| **A6 / B1 / C4** | **Not probed** here — A6/B1 are code-grep criteria (verify by `grep` in review), C4 is not built. The script prints an explicit note for each. |

### The missing-tool problem (jq / python3 on S1)

S1's `python3` is the Xcode-CLT stub and `jq` may be absent, so the harness uses **neither** for
anything load-bearing: flat JSON fields are read with `grep`/`sed`, and JWTs are base64url-decoded with
`openssl base64 -d` (falling back to `base64 -D`/`-d`). If a genuinely required tool is missing, the
affected check DEGRADES to SKIP with a clear message rather than FAILing.

## Honest status line (update this, don't inflate it)

- **Phase 4.10-A (broker + KC clients + edge-hardening):** GATE 1 ✅ (merged, 452 tests). GATE 2/3 ❌.
- **Phase 4.10-B (swap adapters onto the broker):** not started.
- **Cross-service composition (Part C):** emitters exist individually; **run-id correlation across
  audit/trace/lineage/provenance is NOT proven** — this is the biggest unverified claim and the real
  test of "integrate very well."
- **The verify harness:** built (`deploy/verify-integration.sh`). Until it runs clean (0 FAIL, and the
  VERIFIED-gate ids PASS rather than SKIP) on the live box, "integration works" is still unproven —
  SKIPs are honest NOT-VERIFIEDs, not passes.

**Rule for this workstream:** report progress as a gate (`A2: CODE`), never as a bare "done." "Done"
means VERIFIED, and VERIFIED means the probe passed on the live box.

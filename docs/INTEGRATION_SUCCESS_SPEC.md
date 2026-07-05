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

Success is measured by a **runnable probe script**, not by review. Build `deploy/verify-integration.sh`
(a sibling to `deploy/prod.sh verify`) that runs against the live server and prints PASS/FAIL per
criterion above. Until that script exists and passes, integration status is "GATE 1 — code only."

Skeleton (each check maps to a criterion ID; exits non-zero on any FAIL):
```
A2: for svc in gateway opensearch fleet temporal seaweedfs; do
      token=$(client_credentials grant for offgrid-$svc)
      aud=$(decode $token .aud);  [ "$aud" = "offgrid-$svc" ] && PASS A2/$svc || FAIL
    done
A4: from a NON-S1 host: curl --max-time 3 offgrid-s1.local:9200 → expect failure = PASS
C2: runId=$(run one governed agent); sleep; \
    check OpenSearch offgrid-audit for runId · Langfuse trace · Marquez event · provenance record \
    → all 4 present = PASS
```

## Honest status line (update this, don't inflate it)

- **Phase 4.10-A (broker + KC clients + edge-hardening):** GATE 1 ✅ (merged, 452 tests). GATE 2/3 ❌.
- **Phase 4.10-B (swap adapters onto the broker):** not started.
- **Cross-service composition (Part C):** emitters exist individually; **run-id correlation across
  audit/trace/lineage/provenance is NOT proven** — this is the biggest unverified claim and the real
  test of "integrate very well."
- **The verify harness:** not built. Until it is, "integration works" is unproven.

**Rule for this workstream:** report progress as a gate (`A2: CODE`), never as a bare "done." "Done"
means VERIFIED, and VERIFIED means the probe passed on the live box.

# Release verification — 49-service inventory

Use this guide to verify one immutable Console release against the canonical service inventory and
four capability gates. It does not prove every upstream feature. A service can be deployed and
healthy while most of its upstream capability set is unaudited or intentionally unsupported.

## Evidence levels

| Level     | What it proves                                                            | What it does not prove                         |
| --------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| **Code**  | The registry, adapter, route, or UI exists in the release SHA.            | That deployment configuration selects it.      |
| **Local** | Focused tests and a local rendered journey pass for that SHA.             | That the on-prem fleet can reach the boundary. |
| **Live**  | The exact deployed SHA completes the real fleet probe or operator action. | Unexercised upstream capabilities.             |

Record every result at one of these levels. `SKIP`, `partial`, `stale`, and `not audited` are not
passes.

## Expected inventory contract

Open `/operations/services/capability-map` and verify:

- **49 total entries**: 43 platform entries owned by Operations / Services and six enterprise
  sources owned by Data / Sources.
- **Five versioned audit records**: four current and one stale. This is not five current audits.
- **44 entries without a versioned denominator**. They show `pending`, never 0% or 100%.
- The current records are Evidently `0.4.40`, Presidio `2.2.356`, Redpanda `24.2.7`, and the mutable
  LiteLLM `main-stable` image.
- OTel `0.116.0` is visibly **stale** because the fleet runs `0.156.0`. Every OTel Available gate is
  `no` until `0.156.0` is re-audited.

For a focused local contract check, run:

```bash
node --test --experimental-strip-types --import ./test/support/register-alias.mjs \
  test/service-capability-map.test.ts \
  test/service-capability-map.integration.test.ts \
  test/service-inventory.test.ts
```

This is local evidence only. Record the release SHA and the pass/fail tally.

## Current audit records — routes and actions

Each row starts at the selected capability-map deep link. Inspect all four columns independently:
Available, Integrated, UI exposed, and Used in workflow.

| Record                     | Capability-map route                                         | Operator route and verification action                                                                                                                                                                                                                                                                         | Honest result boundary                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidently `0.4.40`         | `/operations/services/capability-map?service=evidently`      | Open `/insights/quality/drift`. Run Dataset Drift, then select PSI and inspect the other catalog choices.                                                                                                                                                                                                      | Dataset Drift is integrated; PSI can use the first-party fallback. Data Summary, Data Quality, arbitrary stat tests, per-column overrides, and report history remain gaps unless their specific result is proven. |
| Presidio `2.2.356`         | `/operations/services/capability-map?service=presidio`       | On `/governance/guardrails/test`, scan and redact a disposable email value. Inspect `/governance/guardrails/recognizers` and `/governance/guardrails/thresholds`; on a disposable tenant, create, edit, and delete a temporary recognizer and restore any threshold changed for the test.                      | Text detection/redaction, recognizers, deny lists, and thresholds have verified paths. Do not infer multilingual, advanced anonymizer, or image-redaction coverage.                                               |
| Redpanda `24.2.7`          | `/operations/services/capability-map?service=streaming`      | Use `/operations/services/streaming?manage=topics` for topic create, partition/retention update, JSON produce, and exact-name delete. Use `?manage=schemas` for AVRO/JSON/Protobuf version create, version delete, and confirmed subject delete. Use `?manage=workflows` for both lender and insurance proofs. | Code/local evidence exists. Topic mutation, produce/consume, schema proof, and both BFSI proofs stay **not live verified** until the Console-originated Kafka round-trip succeeds on the deployed fleet.          |
| LiteLLM `main-stable`      | `/operations/services/capability-map?service=litellm`        | Open `/runtime/models/routing`; inspect the selected inference door, deployment inventory, health, and returned key-budget snapshot. Follow the linked provider, traffic, and cost views.                                                                                                                      | Mutable-version warning remains. Do not claim live failover, enforced budgets, virtual-key CRUD, callbacks, cache, or proxy guardrails without their own live proof.                                              |
| OTel `0.116.0` — **stale** | `/operations/services/capability-map?service=otel-collector` | Confirm the stale version label, then inspect `/operations/services/otel-collector`, `/operations/health/traces`, `/operations/health/metrics`, and `/operations/health/logs`. A protocol probe and trace read-back can prove the deployed `0.156.0` path is functional.                                       | Functional deployment evidence is not an upstream `0.156.0` denominator audit. Keep every Available gate `no` until re-audited from versioned primary sources.                                                    |

### Redpanda lender and insurance proof

The workflow view exposes two deterministic actions:

- **Lender delinquency** registers `lender.delinquency-events-value`, publishes to
  `lender.delinquency-events`, and consumes the same `eventId`.
- **Insurance claim** registers `insurance.claim-events-value`, publishes to
  `insurance.claim-events`, and consumes the same `eventId`.

A live pass must show the returned event id, topic, subject, partition, offset, and verification
time. A green focused boundary test or a rendered button is only local evidence. The current fleet
record says the native Console Kafka path is not deployed correctly; do not upgrade either workflow
gate until the S1 listener metadata and both round-trips pass.

## The 44 unaudited entries

For each id below, open
`/operations/services/capability-map?service=<id>`. Verify the page recognizes the inventory entry,
states that its capability audit is pending, assigns no denominator or percentage, and links to its
canonical owner. The platform detail route is `/operations/services/<id>`. Enterprise sources link
to `/data/sources`; their deployment fixture is not a fabricated connector id.

- **Operations (12):** `console`, `edge-gateway`, `provit`, `redis`, `superset`, `fleetdm`,
  `cloudflared`, `landing`, `status-page`, `litellm-forwarder`, `observability-forwarder`,
  `fleet-forwarder`.
- **Runtime (6):** `gateway`, `temporal`, `gateway-control`, `agent-worker`, `app-worker`,
  `chat-worker`.
- **Data (9):** `postgres`, `qdrant`, `marquez`, `lancedb`, `seaweedfs`, `warehouse`, `airbyte`,
  `data-quality`, `kestra`.
- **Governance (5):** `llm-guard`, `keycloak`, `opa`, `openbao`, `unleash`.
- **Observability (6):** `opensearch`, `langfuse`, `ragas`, `victoriametrics`, `victorialogs`,
  `jaeger`.
- **Enterprise sources (6):** `enterprise-source-corebank`, `enterprise-source-policyadmin`,
  `enterprise-source-erp`, `enterprise-source-kafka`, `enterprise-source-minio`,
  `enterprise-source-crm`.

## Wide and narrow UI verification

Verify light and dark themes at **1600×1000** and **390×844** after loading and animation settle.

1. At the base capability-map route, confirm the page fills the available desktop width; the five
   summary cards do not overlap; long version/source badges wrap; and tables scroll inside their own
   containers without horizontal page overflow.
2. Open
   `/operations/services/capability-map?service=otel-collector&q=telemetry&family=observability`.
   Confirm service selection and “Show all audited services” preserve `q` and `family`; “Clear”
   removes filters but preserves the selected service; browser Back restores each prior state.
3. Filter `owner=data-sources` and confirm six rows. At narrow width, the search, family, owner,
   Apply, and Clear controls stack without clipping or covering the results.
4. Test an empty query result and `?service=not-a-service`. The former offers Clear filters; the
   latter says Service not found rather than calling an unknown id unaudited.
5. Tab through every control. Focus must remain visible, the order must follow the visual order, and
   every link must be operable without a pointer.

A screenshot file is not a pass until its pixels have been inspected for clipping, overlap,
truncation, blank content, and wasted desktop space.

## Live eight-node and inventory verification

Deployment-specific commands and truth live in the private sibling repository. From that repository,
run the current recovery health gate:

```bash
deploy/onprem/recover.sh health
```

Then run the Console integration harness on S1 with the release environment:

```bash
ssh admin@offgrid-s1.local \
  'OFFGRID_ENV_FILE=/tmp/offgrid-verify.env /Users/admin/offgrid/fleet/deploy/verify-integration.sh'
```

Record, do not assume:

- the immutable source SHA, built artifact SHA, deployed release stamp, and rollback SHA;
- reachability for exactly `s1,g1,g2,g3,g4,g5,g6,g7` — no retired `S2` or `g8`;
- exactly 43 service-health entries plus six running enterprise source fixtures;
- every PASS, FAIL, and explicit SKIP from both gates;
- the Redpanda native Kafka result separately from Admin API and Schema Registry health.

If one node, inventory entry, functional probe, or seeded fixture fails, report that gate as failed.
Do not summarize it as “all services are up.”

## Seed-tenant verification

The two canonical demo tenants are:

- `org_bharat` — Bharat Union, bank flavour;
- `org_suraksha` — Suraksha Life, insurer flavour.

Seeding writes data. Run it only on the intended environment with deployment authority, never as a
read-only verification shortcut:

```bash
npm run seed:tenants
# or reconcile one tenant deliberately
OFFGRID_SEED_TENANT=org_bharat npm run seed:tenants
OFFGRID_SEED_TENANT=org_suraksha npm run seed:tenants
```

For each tenant, sign in with its configured viewer identity and verify distinct, non-empty data on
`/solutions/apps`, `/runtime/pipelines`, `/data`, `/solutions/agents`, and `/build/evals`. Open at
least one detail route from each collection and use browser Back. Verify the bank session cannot open
the insurer's entity ids and the insurer session cannot open the bank's. A seeded row count is not
tenant-isolation proof.

## Release report

Publish one short gate report:

```text
Release SHA / artifact SHA / deployed stamp:
Code: pass | fail — command and tally
Local UI: pass | fail | not run — wide/narrow/theme evidence
Inventory: 49 = 43 platform + 6 enterprise sources
Audits: 4 current + 1 stale OTel + 44 without records
Fleet: 8/8 nodes or exact failures
Seed tenants: Bharat pass|fail; Suraksha pass|fail; isolation pass|fail
Redpanda: Admin; Schema Registry; native Kafka; lender proof; insurance proof
Live harness: pass / fail / skip tally
Known gaps and intentionally unsupported capabilities:
```

Use “release verified” only when the code, local, and required live gates all pass for the same
immutable SHA. Keep partial and unsupported upstream capabilities explicit.

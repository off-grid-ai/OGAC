# Redpanda operator surface

The Console manages the deployed Redpanda `24.2.7` service through two real boundaries:

- the native Kafka protocol for topic lifecycle, producing, and consuming;
- the built-in Schema Registry HTTP API for schema subjects and versions.

The HTTP Proxy is not required by the Console and remains visibly `unconfigured` unless a deployment
chooses to expose it. A missing HTTP Proxy must not make native Kafka capabilities look unavailable.

## Runtime configuration

The Console process needs these server-side values:

```dotenv
OFFGRID_REDPANDA_ADMIN_URL=http://127.0.0.1:8943
OFFGRID_REDPANDA_SCHEMA_URL=http://127.0.0.1:8946
OFFGRID_REDPANDA_BROKERS=offgrid-g6.local:19092
OFFGRID_REDPANDA_CLIENT_ID=offgrid-console
```

Do not expose the Kafka listener or Registry publicly. The current fleet boundary is internal-only and
admin-gated by the Console. TLS/SASL and tenant-scoped Kafka principals are not yet configured; that is
a release gap for deployments whose internal network is not already trusted.

## Operator journey

Open the Redpanda service detail and use its URL-driven management views:

- `?manage=topics` lists live partition placement and opens a topic detail. Operators can create a
  topic, increase partitions, change bounded retention, publish a JSON object, or delete after an
  exact-name confirmation.
- `?manage=schemas&subject=…` lists live subjects and version history. Operators can register JSON,
  Avro, or Protobuf versions and delete one version or an entire subject.
- `?manage=workflows` runs one of two deterministic BFSI proofs. The Console registers the event
  contract, publishes a correlation-keyed event, consumes that exact event through a temporary group,
  and displays its partition/offset evidence.

The two seeded proof contracts are:

- `lender.delinquency-events` — an overdue-loan event with `daysPastDue` and INR currency;
- `insurance.claim-events` — an indemnity event with claim, policy, estimate, and INR currency.

These are verification journeys, not a claim that every lender or insurer workflow automatically
publishes to Redpanda. A production app or pipeline must explicitly bind its output to a registered
stream before it counts as a business production caller.

## Four-gate evidence for this slice

| Capability                       | Available          | Integrated                                   | UI exposed                           | Used in workflow                                                              |
| -------------------------------- | ------------------ | -------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| Topic list/create/update/delete  | Redpanda Kafka API | Native Kafka adapter                         | Topic list/detail + create sheet     | Seed topics are ensured by each proof; arbitrary lifecycle is operator-driven |
| Schema subject/version lifecycle | Registry API       | Registry HTTP adapter                        | Subject/version list + create/delete | The proof registers the matching JSON contract                                |
| JSON produce/consume             | Redpanda Kafka API | Native producer + bounded temporary consumer | Manual producer + proof evidence     | Both seeded BFSI proofs round-trip a correlated event                         |

## Explicit remaining gaps

- Durable consumer-group lag inspection, offset reset, replay checkpoints, and dead-letter handling are
  not exposed.
- Per-subject compatibility mode, compatibility dry-run, references, metadata, and Registry mode are
  not exposed yet.
- Kafka ACL, SCRAM user, quota, and tenant-principal management are not exposed. Do not use this
  operator surface as a multi-tenant security boundary until those controls exist.
- Partition reassignment, maintenance mode, rebalancing, tiered storage, transforms, and broker
  configuration stay in the native operational toolchain; they are not silently counted as Console
  coverage.
- The one-click proof is a real data-path verification, but applications and ETL pipelines still need
  an explicit stream-output/stream-input binding and durable delivery evidence.

Upstream references: [Redpanda 24.2 Schema Registry](https://docs.redpanda.com/streaming/24.2/manage/schema-reg/schema-reg-overview/),
[Schema Registry API](https://docs.redpanda.com/api/doc/schema-registry/), and
[Redpanda 24.2 reference](https://docs.redpanda.com/24.2/reference/). Redpanda `24.2` is end-of-life;
the pinned fleet version should be upgraded through the fleet repository with compatibility testing.

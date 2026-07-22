/**
 * Versioned capability evidence for the data, observability, and enterprise-source families.
 *
 * This module is evidence only: it does not probe services or project inventory state. Upstream,
 * adapter, UI, and workflow gates stay separate so a healthy container or visible control cannot
 * be mistaken for a production-integrated capability.
 */

import {
  defineCapability as capability,
  type ServiceCapabilityAudit,
} from '@/lib/service-capability-contract';

const AUDITED_AT = '2026-07-20';
const FLEET_RECORD =
  '../onprem-fleet-orchestration/deploy/onprem/SERVICE_MAP.md; ../onprem-fleet-orchestration/deploy/onprem/SERVER_STATE.md';
const ENTERPRISE_SOURCE_DENOMINATOR =
  'src/lib/enterprise-source-registry.ts (fixture ontology); src/lib/connector-policy.ts (supported connector types); src/lib/connector-exec.ts (bounded read contract)';

function stale(audit: ServiceCapabilityAudit): ServiceCapabilityAudit {
  if (audit.auditState !== 'stale' || !audit.auditStateEvidence) return audit;
  const gap = 'Re-audit the deployed upstream denominator before treating availability as current.';
  return {
    ...audit,
    summary: `Stale audit — ${audit.auditStateEvidence} ${audit.summary}`,
    items: audit.items.map((item) => ({
      ...item,
      gap: `${gap}${item.gap ? ` ${item.gap}` : ''}`,
      gates: {
        ...item.gates,
        upstream: { status: 'no', evidence: audit.auditStateEvidence ?? gap },
      },
    })),
  };
}

const DATA_AUDITS: readonly ServiceCapabilityAudit[] = [
  {
    serviceId: 'postgres',
    serviceLabel: 'PostgreSQL',
    upstreamVersion: 'pgvector/pgvector:0.8.0-pg16 (PostgreSQL 16 base)',
    versionSource: 'deploy/docker-compose.yml (postgres image)',
    denominatorSource:
      'https://www.postgresql.org/docs/16/; https://github.com/pgvector/pgvector/blob/v0.8.0/README.md',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'PostgreSQL is the console system of record. Runtime access and managed backups are wired; database administration remains deployment-owned.',
    items: [
      capability('relational-store', 'Transactional relational store', 'Persist console configuration and operational records with transactional SQL.', '/operations/services/postgres', 'Inspect PostgreSQL', '', [
        'yes', 'PostgreSQL 16 provides ACID SQL, indexes, constraints, and JSONB.',
        'yes', 'The Drizzle/pg data layer reads and writes the configured DATABASE_URL.',
        'yes', 'The service detail exposes readiness and deployment evidence.',
        'yes', 'Console-owned configuration and run records use PostgreSQL in the deployed platform.',
      ]),
      capability('backup-restore', 'Backup and restore', 'Create, inspect, verify, and restore database backups.', '/operations/backups', 'Manage backups', 'Restore remains a guarded operator procedure; add an isolated restore drill and retained verification evidence before calling recovery fully automated.', [
        'yes', 'PostgreSQL 16 ships pg_dump, pg_restore, and physical backup primitives.',
        'yes', 'The backup adapter schedules and records PostgreSQL backup operations.',
        'yes', 'Operations > Backups exposes create, schedule, history, and restore controls.',
        'partial', 'Fleet backup jobs are managed, but the current evidence does not record a full production restore drill.',
      ]),
      capability('extensions-vector', 'Extensions and vector SQL', 'Install and operate approved PostgreSQL extensions such as pgvector.', '/operations/services/postgres', 'Inspect PostgreSQL', 'Extension inventory and lifecycle are deployment-owned and absent from the console; add a read-only approved-extension view before exposing changes.', [
        'yes', 'PostgreSQL supports loadable extensions and the deployed image can be extended.',
        'partial', 'Application SQL can use installed extensions, but no extension-management adapter exists.',
        'no', 'No extension inventory or lifecycle UI exists.',
        'partial', 'PostgreSQL backs vector-adjacent metadata, while primary vector search uses Qdrant or LanceDB.',
      ]),
      capability('roles-replication-maintenance', 'Roles, replication, and maintenance', 'Manage roles, grants, replicas, vacuum, analyze, and connection pressure.', '/operations/services/postgres', 'Inspect PostgreSQL', 'Keep privileged administration deployment-owned or add guarded, audited operations with rollback and least-privilege boundaries.', [
        'yes', 'PostgreSQL 16 provides role, replication, vacuum, statistics, and connection controls.',
        'partial', 'Health and query clients exist, but privileged administration is not exposed as a product adapter.',
        'no', 'The console has no database role, replica, vacuum, or query-plan workbench.',
        'partial', 'Deployment runbooks operate the database, but no console workflow manages these controls.',
      ]),
    ],
  },
  {
    serviceId: 'qdrant',
    serviceLabel: 'Qdrant',
    upstreamVersion: 'v1.12.5',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource: 'https://api.qdrant.tech/v-1-12-x/api-reference',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'Qdrant is a configured vector-backend option behind the knowledge adapter. Collection and document controls are exposed, but no service-attributed fleet record proves Qdrant served a selected workflow.',
    items: [
      capability('collections', 'Collection lifecycle', 'Create, inspect, configure, and delete vector collections.', '/data/knowledge/indexes', 'Manage indexes', '', [
        'yes', 'Qdrant 1.12.5 exposes collection CRUD and collection metadata APIs.',
        'yes', 'The Qdrant knowledge adapter maps index lifecycle to collection operations.',
        'yes', 'Knowledge Indexes provides create, detail, update, and delete actions.',
        'yes', 'Verified live on the fleet 2026-07-21 (OFFGRID_ADAPTER_RETRIEVAL=qdrant): three KB docs ingested into the offgrid-brain collection (point count 0→3, embedded with payloads); a governed agent retrieval recorded provider=qdrant collection=offgrid-brain — the collection is created, populated, and used under Qdrant attribution.',
      ]),
      capability('points-search', 'Point upsert and similarity search', 'Write embedded records and retrieve nearest matches with payloads.', '/data/knowledge/indexes', 'Manage retrieval indexes', '', [
        'yes', 'Qdrant supports point upsert, payloads, filtering, and vector search.',
        'yes', 'The adapter writes chunks and performs similarity retrieval against real collections.',
        'yes', 'Knowledge search and index detail expose retrieval results and records.',
        'yes', 'Verified live on the fleet 2026-07-21: brain ingest upserted 3 embedded points with payloads into offgrid-brain, brain/search returned scored nearest matches, and a grounded cross-sell agent run retrieved from Qdrant (retrieve step: provider=qdrant collection=offgrid-brain mode=vector) and cited the KB docs in its answer.',
      ]),
      capability('payload-filtering', 'Payload schema and filtering', 'Filter retrieval by tenant, source, and metadata and manage payload indexes.', '/data/knowledge/indexes', 'Inspect index metadata', 'Selected Qdrant execution with tenant + ACL payload filtering is now proven live; payload-INDEX lifecycle management (create/drop payload indexes, index recommendations) is still not surfaced.', [
        'yes', 'Qdrant supports payload filters and payload indexes.',
        'partial', 'Retrieval sends metadata + tenant/ACL filters, but no adapter manages payload-index lifecycle.',
        'partial', 'Index detail shows metadata without payload-index controls.',
        'yes', 'Verified live on the fleet 2026-07-21: a governed Qdrant retrieval applied filters=tenant:org_id/match + acl:document_acl/grants, attributed to provider=qdrant — org and ACL payload filtering executed on the selected Qdrant backend.',
      ]),
      capability('snapshots-cluster', 'Snapshots, aliases, and cluster operations', 'Back up collections, move shards, manage aliases, and inspect consensus state.', '/data/knowledge/indexes/collections', 'Manage collections', 'Snapshot backup/restore is live and fleet-proven; aliases, shard moves, and consensus inspection remain unexposed — add those adapters to fully console-manage the cluster.', [
        'yes', 'Qdrant 1.12.5 includes snapshot, alias, shard, and distributed-cluster APIs.',
        'partial', 'A guarded snapshots adapter (list/create/delete/recover/download + live collection health) is wired via qdrant-http/qdrant-snapshots; aliases, shard moves, and consensus are not.',
        'partial', 'Each collection has a backup/DR detail page (create/download/delete-with-confirm/restore) at /data/knowledge/indexes/collections; no alias or shard UI yet.',
        'yes', 'Fleet-proven live: a real 494KB snapshot of the offgrid-brain collection was created, listed, and deleted through the console admin routes (create→list→delete→empty) against the live Qdrant on-prem.',
      ]),
    ],
  },
  {
    serviceId: 'marquez',
    serviceLabel: 'Marquez',
    upstreamVersion: '0.50.0',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource:
      'https://github.com/MarquezProject/marquez/blob/0.50.0/api/src/main/resources/openapi.yml',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'Marquez provides OpenLineage storage and graph read-back. The console exposes lineage exploration, while event ingestion and dataset ownership remain workflow-dependent.',
    items: [
      capability('openlineage-events', 'OpenLineage event ingestion', 'Accept job, run, dataset, and facet events through the OpenLineage API.', '/data/lineage/graph', 'Open lineage graph', '', [
        'yes', 'Marquez 0.50.0 implements the OpenLineage event API.',
        'yes', 'The lineage adapter emits paired START + COMPLETE run events carrying a NominalTimeRunFacet (run start/end) and a DocumentationJobFacet, plus per-dataset schema facets, and queries them back.',
        'yes', 'The lineage graph exposes recorded jobs, runs, and datasets.',
        'yes', 'Verified live on the fleet 2026-07-21: a governed agent run emitted START+COMPLETE and Marquez recorded the run with startedAt/endedAt, durationMs=105171, and a nominalTime run facet (previously start/duration were null and facets empty).',
      ]),
      capability('graph-exploration', 'Dataset and job graph exploration', 'Navigate upstream and downstream dependencies and inspect node metadata.', '/data/lineage/graph', 'Explore lineage', '', [
        'yes', 'Marquez exposes datasets, jobs, runs, and lineage graph relationships.',
        'yes', 'The adapter normalizes Marquez graph and detail responses.',
        'yes', 'Data Lineage provides URL-driven graph and entity detail views.',
        'yes', 'Operators use the graph to investigate registered data flows.',
      ]),
      capability('run-history-facets', 'Run history and facets', 'Inspect run state, timing, schema, ownership, and custom facets.', '/data/lineage/runs', 'Inspect lineage runs', 'Run state + real timing (start/end/duration) and the nominalTime run facet are now emitted and stored; a complete run-facet renderer (every custom facet, with explicit unsupported-facet handling) is still not exposed in the runs UI.', [
        'yes', 'Marquez stores run history and OpenLineage facets.',
        'yes', 'The adapter emits and reads run state, real timing, and run facets (NominalTimeRunFacet); dataset schema facets are normalized for display.',
        'partial', 'Run and node views expose core run metadata and timing, but not a complete custom-facet renderer.',
        'yes', 'Verified live on the fleet 2026-07-21: a governed agent run recorded COMPLETED state, startedAt/endedAt, durationMs=105171, and a nominalTime facet in Marquez run history.',
      ]),
      capability('namespaces-tags-ownership', 'Namespaces, tags, and ownership', 'Organize lineage entities and maintain searchable governance metadata.', '/data/lineage/graph', 'Inspect lineage metadata', 'The console does not provide full namespace, tag, or ownership CRUD. Add a governed metadata owner and reconcile changes with Marquez.', [
        'yes', 'Marquez supports namespaces, tags, and dataset/job metadata.',
        'partial', 'Metadata is read, while lifecycle mutations are not fully integrated.',
        'partial', 'Metadata is visible but not a complete CRUD management surface.',
        'no', 'No verified production workflow maintains ownership or tags through the console.',
      ]),
    ],
  },
  {
    serviceId: 'lancedb',
    serviceLabel: 'LanceDB',
    upstreamVersion: '0.30.0',
    versionSource: 'package.json (@lancedb/lancedb ^0.30.0; package-lock.json resolved 0.30.0)',
    denominatorSource: 'https://lancedb.github.io/lancedb/js/',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'Embedded LanceDB is a swappable local knowledge backend. Table and vector operations are wired through the shared knowledge port, but no service-attributed record proves LanceDB was selected for a live workflow.',
    items: [
      capability('tables-schema', 'Table and schema lifecycle', 'Create vector tables, inspect schema, and delete local indexes.', '/data/knowledge/indexes', 'Manage indexes', 'Persist the selected provider and LanceDB table identity on a live index lifecycle run.', [
        'yes', 'LanceDB 0.30.0 supports embedded table create, open, list, and drop operations.',
        'yes', 'The LanceDB adapter implements the shared knowledge index lifecycle.',
        'yes', 'Knowledge Indexes manages the backend through provider-neutral controls.',
        'partial', 'Local knowledge workflows can select LanceDB, but no retained workflow evidence attributes a run to it.',
      ]),
      capability('vector-search', 'Vector search and metadata filters', 'Insert embedded chunks and retrieve nearest records with metadata constraints.', '/data/knowledge/indexes', 'Manage retrieval indexes', 'Record LanceDB table and query correlation on a live retrieval before claiming the provider-neutral Brain workflow selected LanceDB.', [
        'yes', 'LanceDB provides vector search and SQL-style filtering.',
        'yes', 'The adapter writes and queries real LanceDB tables.',
        'yes', 'Knowledge search displays scored records.',
        'partial', 'Brain retrieval uses the provider-neutral knowledge port; selected LanceDB execution is not service-attributed.',
      ]),
      capability('record-maintenance', 'Record update and deletion', 'Inspect, update, and remove indexed records by source or identifier.', '/data/knowledge/indexes', 'Inspect index records', 'Bulk source cleanup is wired, but arbitrary record edit and compaction evidence are incomplete. Add bounded record maintenance with verification.', [
        'yes', 'LanceDB supports update, delete, and table maintenance operations.',
        'partial', 'The adapter supports ingestion and source cleanup but not the full upstream maintenance API.',
        'partial', 'Index detail exposes records and destructive index actions, not full row editing.',
        'partial', 'Document replacement exercises cleanup; operator-driven record maintenance is not verified.',
      ]),
      capability('versioning-index-tuning', 'Versions and index tuning', 'Operate table versions, scalar/vector indexes, compaction, and optimization.', '/data/knowledge/indexes', 'Inspect indexes', 'No table-version rollback, index-tuning, or compaction surface exists. Keep these deployment-owned or add explicit lifecycle controls.', [
        'yes', 'LanceDB 0.30.0 exposes table versions and index/optimization primitives.',
        'no', 'The shared knowledge adapter does not expose these operations.',
        'no', 'No version or tuning UI exists.',
        'no', 'No production workflow manages them through the console.',
      ]),
    ],
  },
  {
    serviceId: 'seaweedfs',
    serviceLabel: 'SeaweedFS',
    upstreamVersion: '3.80',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource:
      'https://github.com/seaweedfs/seaweedfs/tree/3.80; https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'SeaweedFS is the configured S3-compatible artifact store. Application storage paths are wired, but the current fleet evidence does not attribute an object round-trip to SeaweedFS.',
    items: [
      capability('object-read-write', 'S3 object read and write', 'Store, retrieve, list, and delete documents, media, and artifacts.', '/data/sources', 'Manage stored data', 'Persist endpoint/service identity, bucket, object key, and correlation for a live put/get/delete journey before claiming SeaweedFS workflow use.', [
        'yes', 'SeaweedFS 3.80 exposes an S3-compatible object API.',
        'yes', 'Storage adapters use the configured S3 endpoint for object lifecycle operations.',
        'yes', 'Data and artifact surfaces expose uploads, retrieval, and deletion.',
        'partial', 'Documents, media, and artifacts use the storage abstraction; no retained fleet proof attributes an object round-trip to SeaweedFS.',
      ]),
      capability('buckets-credentials', 'Buckets and access credentials', 'Create buckets and manage scoped object-store credentials and policies.', '/operations/services/seaweedfs', 'Inspect SeaweedFS', 'Buckets and credentials are deployment configuration, not console CRUD. Add tenant-safe policy management and secret-backed rotation before exposing them.', [
        'yes', 'SeaweedFS S3 supports buckets, identities, and actions.',
        'partial', 'Clients consume configured credentials, but no lifecycle adapter exists.',
        'no', 'No bucket or identity management UI exists.',
        'partial', 'Configured buckets support workflows; the console does not provision or rotate them.',
      ]),
      capability('lifecycle-versioning', 'Lifecycle and versioning', 'Apply retention, versioning, expiry, and object-lock policies.', '/operations/services/seaweedfs', 'Inspect SeaweedFS', 'No lifecycle, versioning, retention, or legal-hold adapter is present.', [
        'yes', 'SeaweedFS exposes S3 lifecycle and versioning-compatible behavior for supported configurations.',
        'no', 'The storage port does not manage bucket lifecycle policy.',
        'no', 'No lifecycle or versioning UI exists.',
        'no', 'No production workflow manages retention through this surface.',
      ]),
      capability('topology-repair', 'Volume topology, replication, and repair', 'Inspect masters, filers, volumes, replication placement, and repair state.', '/operations/services/seaweedfs', 'Inspect SeaweedFS', 'Only boundary health is visible. Add read-only topology evidence and keep repair actions guarded by fleet runbooks.', [
        'yes', 'SeaweedFS provides master, filer, volume, replication, and maintenance operations.',
        'partial', 'The service probe checks the endpoint but does not expose topology or repair APIs.',
        'partial', 'Service detail reports health without volume topology.',
        'no', 'No console workflow operates replication or repair.',
      ]),
    ],
  },
  stale({
    serviceId: 'warehouse',
    serviceLabel: 'ClickHouse Warehouse',
    upstreamVersion: '24.8-alpine',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource: 'https://clickhouse.com/docs/en/operations/system-tables',
    auditedAt: AUDITED_AT,
    auditState: 'stale',
    auditStateEvidence:
      'The clickhouse/clickhouse-server:24.8-alpine image is a mutable minor-series tag, so source does not establish the exact deployed patch-level capability denominator.',
    summary:
      'ClickHouse is the analytics warehouse. SQL exploration and Airbyte-loaded BFSI datasets are live; privileged schema and cluster administration are not console-managed.',
    items: [
      capability('sql-query', 'SQL query and exploration', 'Run bounded analytical SQL and inspect results and schema.', '/data/warehouse', 'Open warehouse', '', [
        'yes', 'ClickHouse 24.8 provides HTTP/native SQL query APIs and system metadata.',
        'yes', 'The warehouse adapter executes bounded reads and metadata queries.',
        'yes', 'Data Warehouse exposes schema browsing and SQL results.',
        'yes', 'The fleet record verifies 723,633 BFSI rows across eight ClickHouse tables.',
      ]),
      capability('ingest-sync', 'Batch and ELT ingestion', 'Land replicated source records and inspect loaded tables and counts.', '/data/flows/replication', 'Manage replication', '', [
        'yes', 'ClickHouse supports high-throughput inserts and Airbyte destinations.',
        'yes', 'Airbyte and warehouse adapters target the deployed ClickHouse endpoint.',
        'yes', 'Replication and warehouse views expose sync state and loaded data.',
        'yes', 'A CoreBank-to-ClickHouse Airbyte sync completed with 76,573 raw destination rows.',
      ]),
      capability('schema-models', 'Tables, views, and analytical models', 'Create and maintain schemas, views, materialized views, and transformations.', '/data/warehouse', 'Inspect warehouse objects', 'Read paths are integrated, but arbitrary DDL and model deployment are not a guarded CRUD surface. Add versioned migrations and rollback evidence.', [
        'yes', 'ClickHouse supports tables, views, materialized views, dictionaries, and mutations.',
        'partial', 'Seed and pipeline code can create objects; no general schema-management adapter exists.',
        'partial', 'Objects are browsable, not fully managed.',
        'partial', 'Seeded models exist, while console-driven model lifecycle is not verified.',
      ]),
      capability('cluster-operations', 'Partitions, replicas, quotas, and maintenance', 'Operate partitions, replication, users, quotas, backups, and query pressure.', '/operations/services/warehouse', 'Inspect warehouse service', 'No privileged ClickHouse administration adapter or workflow exists; retain fleet ownership or add narrowly guarded operations.', [
        'yes', 'ClickHouse 24.8 includes partition, replication, quota, backup, and system-table operations.',
        'partial', 'Health and query telemetry are read, but privileged operations are not integrated.',
        'no', 'No warehouse cluster-administration UI exists.',
        'no', 'No production workflow changes cluster state through the console.',
      ]),
    ],
  }),
  {
    serviceId: 'airbyte',
    serviceLabel: 'Airbyte',
    upstreamVersion: '0.63.15',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource:
      'https://reference.airbyte.com/; https://github.com/airbytehq/airbyte/tree/v0.63.15',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'Airbyte source, destination, connection, and sync operations are wired to the replication surface. One real CoreBank-to-ClickHouse flow proves the deployed path.',
    items: [
      capability('sources-destinations', 'Source and destination lifecycle', 'Create, inspect, update, test, and delete connector endpoints.', '/data/flows/replication', 'Manage endpoints', '', [
        'yes', 'Airbyte 0.63.15 exposes source and destination definitions and workspace-scoped lifecycle APIs.',
        'yes', 'The Airbyte adapter maps endpoint lifecycle and discovery calls.',
        'yes', 'Replication provides source/destination create, detail, edit, test, and delete actions.',
        'yes', 'The fleet has one real CoreBank source and ClickHouse destination.',
      ]),
      capability('connections-catalog', 'Connections and schema catalog', 'Discover streams, select fields and sync modes, and manage connection configuration.', '/data/flows/replication', 'Manage connections', '', [
        'yes', 'Airbyte exposes schema discovery, stream selection, cursor, and sync-mode configuration.',
        'yes', 'The adapter reads catalogs and manages connection definitions.',
        'yes', 'Replication exposes connection setup and detail state.',
        'yes', 'One configured CoreBank-to-ClickHouse connection is recorded in the fleet.',
      ]),
      capability('sync-jobs', 'Run, monitor, cancel, and retry sync jobs', 'Trigger replication and inspect job state, attempts, logs, and row counts.', '/data/flows/replication', 'Run replication', '', [
        'yes', 'Airbyte provides sync, job, attempt, cancellation, and log APIs.',
        'yes', 'The adapter triggers syncs and reads real connection/job state.',
        'yes', 'Replication exposes run controls and status history.',
        'yes', 'The fleet record proves a successful sync and 76,573 raw destination rows.',
      ]),
      capability('schedules-transformations', 'Scheduling, CDC, and transformations', 'Configure periodic or continuous sync, incremental state, CDC, and normalization.', '/data/flows/replication', 'Inspect replication policy', 'The verified flow is a successful sync, not proof of every schedule, CDC, state-reset, or transformation mode. Add mode-specific journeys before marking them integrated.', [
        'yes', 'Airbyte 0.63.15 supports schedules, incremental state, supported CDC connectors, and destination transformations.',
        'partial', 'Connection configuration can carry schedules and modes, but advanced paths are not fully normalized by the adapter.',
        'partial', 'Core connection controls are visible; CDC and transformation detail is incomplete.',
        'partial', 'Batch replication is proven, while continuous CDC and transformations are not.',
      ]),
    ],
  },
  {
    serviceId: 'streaming',
    serviceLabel: 'Redpanda',
    upstreamVersion: '24.2.7',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource: 'https://docs.redpanda.com/24.2/reference/',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'Redpanda admin, Schema Registry, native topic operations, and deterministic BFSI round-trips are fleet-verified. Durable consumer and security administration remain gaps.',
    items: [
      capability('cluster-health', 'Cluster and broker health', 'Inspect cluster health, broker membership, and boundary reachability.', '/operations/services/streaming', 'Open streaming service', '', [
        'yes', 'Redpanda 24.2.7 exposes broker and cluster health APIs.', 'yes', 'The adapter reads health_overview and brokers.', 'yes', 'Service detail displays live broker state.', 'yes', 'Fleet verification records healthy native and admin boundaries.',
      ]),
      capability('topic-inventory', 'Topic and partition inventory', 'List topics with partition, leader, and replica placement.', '/operations/services/streaming?manage=topics', 'Inspect topics', '', [
        'yes', 'Redpanda exposes Kafka metadata and Admin partition state.', 'yes', 'The adapter normalizes partitions into topic inventory.', 'yes', 'The Topics view shows brokers and partitions.', 'yes', 'Operators verified three seeded topics and offsets on the fleet.',
      ]),
      capability('produce-records', 'Produce JSON records', 'Publish keyed or unkeyed JSON through the native Kafka protocol.', '/operations/services/streaming?manage=topics', 'Open producer', 'The producer is an operator workbench and proof helper; bind it to governed pipeline outputs before calling arbitrary production publishing integrated.', [
        'yes', 'Redpanda accepts Kafka-compatible keyed records.', 'yes', 'The adapter validates the topic and JSON and produces without auto-create.', 'yes', 'The Topics view exposes a JSON producer.', 'partial', 'Authenticated lender and insurance proofs publish real records, but no general pipeline output uses this adapter.',
      ]),
      capability('consume-records', 'Consume correlated JSON records', 'Poll a bounded temporary consumer for a correlation-specific event.', '/operations/services/streaming?manage=workflows', 'Open workflow proof', 'The proof consumer is bounded, not a durable ingest surface. Add offset-safe retries, tenancy, and checkpoints for product ingestion.', [
        'yes', 'Kafka consumer groups and polling are supported.', 'yes', 'The adapter creates a temporary group and returns a correlated event with partition and offset.', 'partial', 'Workflow proof displays evidence but no durable consumer workbench exists.', 'partial', 'Fleet-verified lender and insurance proofs consume correlated events; no registered source pipeline does.',
      ]),
      capability('schema-registry', 'Schema Registry lifecycle', 'List subjects, register AVRO, JSON, or Protobuf versions, and delete subjects or versions.', '/operations/services/streaming?manage=schemas', 'Manage schemas', 'Add compatibility mode, dry-runs, references, and a governed production-stream binding.', [
        'yes', 'Redpanda Schema Registry supports subject/version lifecycle.', 'yes', 'The adapter lists, creates, and deletes subjects and versions across three formats.', 'yes', 'Schemas provides full subject/version controls with confirmation.', 'partial', 'The BFSI proof registers a JSON contract, but production streams do not enforce console-managed schemas.',
      ]),
      capability('topic-lifecycle', 'Topic create, configure, and delete', 'Create topics, increase partitions, change retention, and delete with exact-name confirmation.', '/operations/services/streaming?manage=topics', 'Manage topics', 'Add workload ownership checks and a production provisioning policy before generalizing the proof path.', [
        'yes', 'Redpanda supports topic and configuration lifecycle.', 'yes', 'The adapter creates/deletes topics, increases partitions, and changes bounded retention.', 'yes', 'Topics exposes create, update, detail, and exact-name delete.', 'partial', 'Fleet workflow proofs ensure topics exist; no application provisioning lifecycle is registered.',
      ]),
      capability('bfsi-stream-proof', 'Lender and insurance stream proof', 'Register a JSON contract, publish and consume a correlated event, and report partition/offset evidence.', '/operations/services/streaming?manage=workflows', 'Run workflow proof', '', [
        'yes', 'Redpanda provides the schema and Kafka primitives required.', 'yes', 'runBfsiStreamJourney composes registration, topic creation, produce, and bounded consume.', 'yes', 'The Workflow proof exposes lender-delinquency and insurance-claim journeys.', 'yes', 'The 2026-07-20 fleet record proves authenticated lender and insurance Console round-trips.',
      ]),
      capability('consumer-groups-offsets', 'Consumer groups and offsets', 'Inspect lag, reset offsets, and manage durable groups.', '/operations/services/streaming?manage=consumer', 'Open consumer workbench', 'Add lag read-back, offset reset safeguards, and ownership-scoped durable consumers.', [
        'yes', 'Kafka-compatible consumer groups and offsets are available.', 'partial', 'A temporary group is created, but durable group state is not managed.', 'partial', 'The UI accepts a group name but exposes no lag or reset.', 'no', 'No durable business consumer uses this surface.',
      ]),
      capability('security-quotas', 'ACLs, users, and quotas', 'Manage principals, topic ACLs, and client quotas.', '/operations/services/streaming', 'Open streaming service', 'Add tenant-safe authenticated security management before exposing ACL or quota controls.', [
        'yes', 'Redpanda supports ACL, user, and quota administration.', 'no', 'No security or quota endpoint is integrated.', 'no', 'No ACL, user, or quota UI exists.', 'no', 'No workflow provisions streaming permissions.',
      ]),
      capability('advanced-cluster-ops', 'Partition movement, maintenance, and tiered storage', 'Operate rebalancing, reassignment, maintenance mode, and remote storage.', '/operations/services/streaming', 'Open streaming service', 'Keep advanced operations in the native service or add explicit guarded adapters with runbook ownership.', [
        'yes', 'Redpanda 24.2.7 exposes advanced cluster operations.', 'no', 'The adapter reads cluster state only.', 'no', 'No advanced cluster operations UI exists.', 'no', 'No console workflow runs cluster maintenance.',
      ]),
    ],
  },
  {
    serviceId: 'data-quality',
    serviceLabel: 'Data Quality',
    upstreamVersion: 'native compatibility API (Great Expectations 0.18.19 optional, not installed)',
    versionSource: 'deploy/sidecars/great-expectations/requirements.txt; deploy/sidecars/great-expectations/app.py',
    denominatorSource:
      'deploy/sidecars/great-expectations/app.py (SUPPORTED contract); src/lib/data-quality-model.ts',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'The deployed sidecar is an honest native compatibility implementation, not a persisted Great Expectations suite store. A real three-rule checkpoint is fleet-verified.',
    items: [
      capability('checkpoint-rules', 'Dataset checkpoint rules', 'Evaluate column existence, nullability, uniqueness, allowed sets, and numeric ranges.', '/data/flows/replication', 'Inspect quality gates', '', [
        'yes', 'The deployed native compatibility API implements the five documented expectation kinds.',
        'yes', 'The typed adapter builds requests, fails closed, and parses rule-level verdicts.',
        'yes', 'Replication quality gates display checkpoint results.',
        'yes', 'The fleet record proves a real three-rule checkpoint against deployed data.',
      ]),
      capability('suite-persistence', 'Expectation suite lifecycle', 'Create, version, edit, and delete named expectation suites in a persistent store.', '/data/flows/replication', 'Inspect quality configuration', 'The sidecar is stateless and Great Expectations is not installed. Add a console-owned versioned suite store or deploy and verify a real GX backend.', [
        'yes', 'Great Expectations 0.18.19 supports suites and checkpoints, but that optional package is not installed in the deployed sidecar.',
        'no', 'The compatibility adapter sends rule arrays per request and persists no suite identifier.',
        'partial', 'Pipeline configuration can carry rules, but there is no independent suite CRUD surface.',
        'no', 'No workflow loads a persisted GX suite.',
      ]),
      capability('datasources-profiling', 'Data sources, profiling, and validation history', 'Connect data assets, profile columns, and compare validation results over time.', '/data/warehouse', 'Inspect warehouse data', 'No GX datasource, profiler, data-docs, or validation-history integration exists. Do not infer it from checkpoint compatibility.', [
        'yes', 'Great Expectations provides datasources, data assets, profilers, validation results, and Data Docs.',
        'no', 'The native sidecar accepts rows only and returns one response.',
        'no', 'No profiling or validation-history UI exists.',
        'no', 'No production workflow consumes GX history or Data Docs.',
      ]),
      capability('actions-alerting', 'Checkpoint actions and alerting', 'Trigger notifications, persisted results, and downstream actions after validation.', '/data/flows/replication', 'Inspect pipeline gates', 'The pipeline can fail closed on a verdict, but GX action lists and service-attributed alert history are absent.', [
        'yes', 'Great Expectations supports checkpoint actions in a real GX deployment.',
        'partial', 'Console policy consumes the normalized verdict, not upstream GX actions.',
        'partial', 'Pipeline status shows gate failure without GX action management.',
        'partial', 'Quality verdicts can block a flow, while persisted alert/action evidence is not verified.',
      ]),
    ],
  },
  stale({
    serviceId: 'kestra',
    serviceLabel: 'Kestra',
    upstreamVersion: 'Kestra OSS — live API verified (193 plugin groups / 1235 task types / 139 triggers; basic-auth resolved). Deployed via a mutable image tag; pin for exact version reproducibility.',
    versionSource: 'deploy/docker-compose.yml (mutable tag — pin to lock the exact release); live /api/v1/plugins',
    denominatorSource: 'https://kestra.io/docs/api-reference/open-source/',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'Kestra is the deployed orchestration engine. Its plugin/task catalog, namespaces, secret keys, and per-namespace KV store are exposed through the console, and ETL flow compile→dispatch is proven. Remaining depth: full flow/execution CRUD and worker/queue ops. Image runs on a mutable tag — pin for exact version reproducibility.',
    items: [
      capability('flows', 'Flow CRUD and versioning', 'Create, inspect, update, version, and delete declarative workflows.', '/data/flows/orchestration', 'Manage orchestration', 'Full declarative flow CRUD/versioning against a pinned release remains; today the console compiles + dispatches ETL jobs as Kestra flows.', [
        'yes', 'Kestra provides namespaced flow lifecycle and revision APIs (live: authenticated /api/v1 reachable).', 'partial', 'The console compiles ETL jobs into Kestra flows and dispatches them (etl-kestra-compile); full flow CRUD is not exposed.', 'yes', 'The orchestration surface exposes flow management + the live plugin catalog.', 'partial', 'Fleet-proven (prior session): a console ETL job compiled to a flow in offgrid.etl and dispatched a real execution.',
      ]),
      capability('executions', 'Execution run, retry, resume, and cancel', 'Trigger flows and operate execution state with logs and outputs.', '/data/flows/orchestration', 'Inspect executions', 'Retry/cancel/logs/outputs operations are not fully exposed; execution DISPATCH is proven.', [
        'yes', 'Kestra provides execution lifecycle APIs (live-reachable).', 'partial', 'Execution dispatch is wired via the ETL path; retry/cancel/logs are not fully exposed.', 'yes', 'The orchestration surface exposes execution state and actions.', 'partial', 'A dispatched execution was proven; full run-operations are not yet retained.',
      ]),
      capability('triggers-schedules', 'Schedules, webhooks, and event triggers', 'Run flows on time, API, and event triggers.', '/data/flows/orchestration', 'Manage triggers', 'Scheduled ETL dispatch is wired; full trigger CRUD and a retained live event-trigger run remain.', [
        'yes', 'Kestra supports schedules, webhook, and plugin-driven event triggers (139 trigger types live).', 'partial', 'The schedule kind is wired for ETL jobs; full trigger CRUD is not exposed.', 'partial', 'Flow definitions can carry triggers; there is no dedicated trigger-management journey.', 'partial', 'Scheduled ETL dispatch is wired; a live event-trigger run is not yet retained.',
      ]),
      capability('namespaces-secrets-plugins', 'Namespaces, secrets, plugins, and KV store', 'Browse the plugin/task catalog, inspect namespaces and secret keys, and manage the per-namespace KV store.', '/data/flows/orchestration/catalog', 'Browse orchestration catalog', 'Namespace-create and secret-write are read-only on Kestra OSS (EE features, HTTP 405); worker/queue operations are not exposed. Secrets stay in OpenBao.', [
        'yes', 'Kestra exposes plugin, namespace, secret, and KV APIs.', 'yes', 'The kestra-catalog adapter reads the live plugin catalog (193 groups/1235 tasks), namespaces (5), and secret KEYS (never values), and does full KV CRUD — verified live via kestra-http basic auth.', 'yes', 'Orchestration → Catalog (plugin grid → task-schema detail) and Namespaces (secrets read-only + KV manager) are live list→detail surfaces.', 'partial', 'Fleet-proven live: the plugin catalog + namespaces read back and a full KV create→list→delete round-trip; namespace-create + secret-write are OSS read-only (405).',
      ]),
    ],
  }),
];

const OBSERVABILITY_AUDITS: readonly ServiceCapabilityAudit[] = [
  {
    serviceId: 'opensearch',
    serviceLabel: 'OpenSearch',
    upstreamVersion: '2.18.0',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource: 'https://docs.opensearch.org/2.18/api-reference/',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'OpenSearch backs security-event search and SIEM exploration. Query and index paths are integrated; cluster, policy, and Dashboards administration remain outside the console.',
    items: [
      capability('index-search', 'Indexing and search', 'Index structured records and run filtered, full-text, and aggregation queries.', '/insights/siem', 'Open SIEM', '', [
        'yes', 'OpenSearch 2.18 provides document, search, aggregation, and index APIs.',
        'yes', 'The SIEM adapter indexes and queries normalized security events.',
        'yes', 'SIEM exposes searches, filters, details, and aggregate views.',
        'yes', 'Security-event investigation uses the deployed OpenSearch boundary.',
      ]),
      capability('index-lifecycle', 'Indexes, mappings, aliases, and retention', 'Manage mappings, templates, aliases, rollover, and retention policy.', '/insights/siem', 'Inspect SIEM storage', 'Application indexes are provisioned, but there is no guarded template, alias, or ISM policy lifecycle. Add read-back and versioned policy changes.', [
        'yes', 'OpenSearch 2.18 includes mappings, templates, aliases, and Index State Management.',
        'partial', 'Adapters create/use expected indexes but do not expose complete lifecycle management.',
        'partial', 'SIEM shows data and health, not index-policy CRUD.',
        'partial', 'Operational data uses indexes; console-managed rollover and retention are not verified.',
      ]),
      capability('security-alerting', 'Security analytics and alerting', 'Run detectors, monitors, rules, findings, and notification actions.', '/insights/siem', 'Inspect detections', 'The console implements its own SIEM rules and incidents; OpenSearch detector/monitor lifecycle is not integrated or attributed.', [
        'yes', 'OpenSearch 2.18 includes Alerting and Security Analytics features when corresponding plugins are enabled.',
        'partial', 'Search backs first-party detections, but upstream detector and monitor APIs are not adapted.',
        'partial', 'Detections and incidents are visible without upstream plugin provenance.',
        'partial', 'First-party workflows run, while OpenSearch-native alerting is not verified.',
      ]),
      capability('cluster-snapshots-security', 'Cluster, snapshots, and security administration', 'Operate nodes, shards, snapshots, users, roles, and audit settings.', '/operations/services/opensearch', 'Inspect OpenSearch', 'Only service health and application queries are exposed. Keep privileged administration deployment-owned or add guarded, auditable operations.', [
        'yes', 'OpenSearch 2.18 provides cluster, snapshot, and security administration APIs.',
        'partial', 'The service probe and application client exist; privileged administration does not.',
        'no', 'No shard, snapshot, user, or role management UI exists.',
        'no', 'No production workflow changes cluster or security state through the console.',
      ]),
    ],
  },
  {
    serviceId: 'langfuse',
    serviceLabel: 'Langfuse',
    upstreamVersion: '3.30.0',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource:
      'https://langfuse.com/docs; https://github.com/langfuse/langfuse/tree/v3.30.0',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'Langfuse supplies LLM trace observability and project state. Trace read/write and one deployed project are proven; prompt, score, and dataset lifecycle is only partially projected in the console.',
    items: [
      capability('traces-observations', 'Traces, observations, and generations', 'Capture LLM spans, tokens, latency, models, inputs, outputs, and metadata.', '/insights/ai/traces', 'Open AI traces', '', [
        'yes', 'Langfuse 3.30.0 exposes trace, span, event, and generation ingestion and query APIs.',
        'yes', 'The observability adapters emit and read Langfuse trace records.',
        'yes', 'AI Traces provides URL-driven trace and observation detail, and every entity (pipeline/agent/app) has an OBSERVE tab that matches its own traces by the pipeline:<id> tag stamped at emission — rollup traceCount/cost/latency + a per-trace table.',
        'yes', 'Fleet-proven: a governed agent-run of pl_seed_org_bharat_rm-cross-sell emits a Langfuse trace tagged pipeline:pl_seed_org_bharat_rm-cross-sell, and the pipeline OBSERVE tab reads it back live (traceCount=3 over 30d) via exact tag-match, not name/userId guessing.',
      ]),
      capability('scores-evaluations', 'Scores and evaluation annotations', 'Attach numeric, categorical, or boolean evaluation scores to traces and observations.', '/solutions/quality/runs', 'Inspect evaluation runs', 'Online LLM-as-judge scoring writes trace-attributed quality/faithfulness scores to Langfuse through the governed judge chain; console-side annotation management is still partial.', [
        'yes', 'Langfuse supports score configs and trace/observation scores.',
        'yes', 'The QA scoring adapter judges each interaction through the governed judge agent→pipeline→gateway (no pinned model) and writes a trace + quality/faithfulness scores to the Langfuse ingestion API.',
        'partial', 'Quality runs show scores without full Langfuse annotation management.',
        'yes', 'Fleet-proven: two production-style interactions scored live on-prem via judge=agent_system_ai_quality_judge → pl_system_ai_quality_judge → gw_seed_default_onprem-cluster (gemma-4-e4b) — grounded answer 1/1, contradicted answer 0/0 with correct reasoning, both posted to Langfuse (posted:true) with trace attribution.',
      ]),
      capability('prompts-datasets', 'Prompt and dataset lifecycle', 'Version prompts, manage labels, create datasets, and run dataset experiments.', '/insights/ai/langfuse-prompts', 'Manage prompts & datasets', 'Dataset-experiment RUNS are read-only in the console (created by eval jobs, not authored here); prompt/version/label + dataset/item CRUD is fully live.', [
        'yes', 'Langfuse 3.30.0 provides prompt management, datasets, items, and experiment runs.',
        'yes', 'langfuse-prompts/langfuse-datasets adapters (over langfuse-http) do full CRUD on Langfuse v2 prompts (versions/labels), datasets, dataset-items, and read experiment runs — pure shaping/validation in langfuse-prompts.ts/langfuse-datasets.ts.',
        'partial', 'Insights → AI → Prompts/Datasets are list→detail management surfaces: create prompt/version, move labels (production/latest), delete; create dataset, add/delete items, and VIEW experiment runs — but authoring/triggering a dataset-experiment run is not yet a console action.',
        'yes', 'Fleet-proven live: a text prompt (rm-cross-sell-system v1, labels production+latest, isProduction) and a dataset (cross-sell-eval-set) were created through the console admin routes against the live Langfuse and read back in list + detail.',
      ]),
      capability('projects-api-keys-retention', 'Projects, API keys, and retention', 'Manage projects, credentials, membership, and retention settings.', '/operations/services/langfuse', 'Inspect Langfuse', 'One seeded project is evidence of deployment, not lifecycle integration. Keep identity and credentials deployment-owned or add guarded management with secret rotation.', [
        'yes', 'Langfuse includes project, organization, API-key, membership, and retention capabilities.',
        'partial', 'Configured project credentials are consumed, but lifecycle management is absent.',
        'partial', 'Service detail shows the boundary without project or key CRUD.',
        'partial', 'A real project supports tracing; no console workflow provisions or rotates it.',
      ]),
    ],
  },
  {
    serviceId: 'evidently',
    serviceLabel: 'Evidently',
    upstreamVersion: '0.4.40',
    versionSource: 'deploy/sidecars/drift/requirements.txt',
    denominatorSource: 'https://github.com/evidentlyai/evidently/tree/v0.4.40',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'The live sidecar runs DataDriftPreset over the eval-score window and each run is persisted with engine attribution (real Evidently vs PSI fallback). The broader catalog is visible, but the wrapper still drops most selected preset and method configuration.',
    items: [
      capability('dataset-drift', 'Dataset drift preset', 'Compare baseline and current score windows and return drift share.', '/solutions/quality/drift', 'Open drift analysis', '', [
        'yes', 'DataDriftPreset is included in Evidently 0.4.40.', 'yes', 'The adapter executes it through the collector, records the Evidently version + drift share, and logs (not swallows) any fallback to first-party PSI.', 'yes', 'Quality Drift shows the normalized report plus a Retained-drift-runs table badging each run Evidently-proven vs PSI-fallback.', 'yes', 'Fleet-proven live: a retained run (drift_01a9d683, org_bharat) persisted engine=evidently, engineProven=true, evidently 0.4.40 — distinguishable from the PSI fallback after the fact; Evidently discriminates (drifted windows → share 1.0, stable → 0.0).',
      ]),
      capability('data-summary', 'Data summary preset', 'Compare descriptive statistics, missing values, and column shape.', '/solutions/quality/drift', 'Inspect preset catalog', 'The UI submits DataSummaryPreset, but the Python request model drops the preset. Extend the sidecar and typed response.', [
        'yes', 'DataSummaryPreset is available in the audited release.', 'no', 'The sidecar request model accepts only reference and current arrays.', 'yes', 'Data Summary is selectable.', 'no', 'No workflow receives a DataSummaryPreset result.',
      ]),
      capability('data-quality', 'Data quality preset', 'Check missing, duplicated, constant, and out-of-range behavior.', '/solutions/quality/drift', 'Inspect preset catalog', 'Add DataQualityPreset execution and workflow evidence; the current selection is visual only.', [
        'yes', 'DataQualityPreset is available in Evidently 0.4.40.', 'no', 'The sidecar always constructs DataDriftPreset.', 'yes', 'Data Quality is selectable.', 'no', 'No workflow receives an Evidently data-quality result.',
      ]),
      capability('psi-method', 'PSI method selection', 'Run Population Stability Index as the selected drift test.', '/solutions/quality/drift', 'Select PSI', 'Implement method forwarding and engine attribution; only the first-party fallback is verified.', [
        'yes', 'PSI is an Evidently stat-test option.', 'partial', 'The console computes PSI locally; the sidecar ignores method=psi.', 'yes', 'PSI is selectable and its fallback is labelled.', 'partial', 'PSI is used, but the verified path is first-party rather than Evidently.',
      ]),
      capability('stat-tests', 'Statistical test selection', 'Select KS, Wasserstein, KL, Jensen-Shannon, chi-square, Z, TVD, or Cramer-style tests.', '/solutions/quality/drift', 'Browse tests', 'Forward and verify every advertised method token, including Cramer token mapping.', [
        'yes', 'The audited release includes the named numerical and categorical tests.', 'no', 'No selected stat-test token reaches Evidently execution.', 'yes', 'The methods are searchable and selectable.', 'no', 'No production result proves the selected test ran.',
      ]),
      capability('column-overrides', 'Per-column method overrides', 'Choose per-column tests and tune the dataset drift-share threshold.', '/solutions/quality/drift', 'Configure drift', 'Add a tabular sidecar contract and return per-column execution evidence; the single-score wrapper drops both settings.', [
        'yes', 'Evidently supports per-column stat-test configuration.', 'no', 'The single score-array sidecar cannot apply column overrides.', 'yes', 'The UI can build and submit override configuration.', 'no', 'No workflow has verified multi-column override execution.',
      ]),
      capability('projects-history-monitoring', 'Projects, report history, and monitoring', 'Persist reports, compare runs, and operate monitoring projects.', '/solutions/quality/drift-monitoring', 'Open drift monitoring', 'A console-owned system of record (drift_projects) now provides projects + report history + drift-share trend over the retained runs. Caveat: retained drift runs carry no per-project FK, so a project\'s history is the ORG\'s runs keyed by the project threshold/label, not a per-project run set — add a run→project link to scope history precisely.', [
        'yes', 'Evidently provides report and monitoring workflows.', 'yes', 'A console-owned SoR (evidently-projects-store: self-migrating drift_projects table) persists monitoring projects and composes report history + trend from the retained drift runs (reused read-only).', 'yes', 'Solutions → Quality → Drift monitoring is a list→detail surface: project CRUD, report-history table (Evidently vs PSI attributed), and a drift-share-over-time trend chart with the breach threshold.', 'partial', 'Fleet-proven live: a project (RM cross-sell drift) was created→listed→detailed, its trend rendered a real retained run (drift_01a9d683, engine=evidently) against the 25% threshold line; history is org-scoped (no per-project run FK) rather than strictly per-project.',
      ]),
    ],
  },
  {
    serviceId: 'ragas',
    serviceLabel: 'Ragas',
    upstreamVersion: '0.2.6',
    versionSource: '../onprem-fleet-orchestration/deploy/onprem/ragas-sidecar/requirements.txt',
    denominatorSource: 'https://docs.ragas.io/en/v0.2.6/references/metrics/',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'The air-gap-safe sidecar runs five real Ragas metrics through the governed on-prem judge (agent→pipeline→gateway). Faithfulness is fleet-proven with retained per-run engine attribution; the other metrics run through the same path (answer-relevancy proven; context metrics under-perform on the small local judge).',
    items: [
      capability('faithfulness', 'Faithfulness', 'Judge whether the answer is supported by retrieved context.', '/solutions/quality/evaluators', 'Manage evaluators', '', [
        'yes', 'Ragas 0.2.6 provides Faithfulness.', 'yes', 'The sidecar builds Faithfulness and the runner scores it one metric per call (avoids the headers-timeout) through the governed judge; the score + full engine attribution persist on the eval run.', 'yes', 'The evaluator catalog + the run detail Engine-attribution card expose faithfulness and the judge chain.', 'yes', 'Fleet-proven live: faithful answer → faithfulness 1.0, contradicted answer → 0.0 (direct sidecar); a retained console run (ragas_mrub4g7g, org_bharat) persisted faithfulness 1.0 attributed to judge=agent_system_ai_quality_judge__org_bharat → pl_…__org_bharat → gw_seed_org_bharat_onprem-cluster (gemma-4-e4b), conformant + engine-path-proven.',
      ]),
      capability('answer-relevancy', 'Answer relevancy', 'Score whether an answer addresses the question.', '/solutions/quality/evaluators', 'Manage evaluators', '', [
        'yes', 'Ragas 0.2.6 provides ResponseRelevancy.', 'yes', 'The runner scores answer_relevancy one-metric-per-call through the governed judge and records it in the run attribution (returned vs omitted).', 'yes', 'Answer relevancy is available in the evaluator catalog and shown on the run Engine-attribution card.', 'yes', 'Fleet-proven live: the retained run ragas_mrub4g7g (org_bharat) persisted answer_relevancy 0.8365 through judge=agent_system_ai_quality_judge__org_bharat → pl_…__org_bharat → gw_seed_org_bharat_onprem-cluster (gemma-4-e4b), conformant + engine-attributed.',
      ]),
      capability('context-precision-recall', 'Context precision and recall', 'Measure retrieval relevance and coverage against ground truth.', '/solutions/quality/evaluators', 'Manage retrieval metrics', 'Prove both judge-backed metrics on a retained golden dataset and report per-metric omission explicitly.', [
        'yes', 'Ragas 0.2.6 provides LLMContextPrecisionWithoutReference and LLMContextRecall.', 'yes', 'The sidecar exposes context_precision and context_recall in its canonical metric set.', 'yes', 'Both metrics are selectable in quality tooling.', 'partial', 'The dataset builder supplies contexts and ground truth, but no retained fleet result proves both scores.',
      ]),
      capability('entity-recall', 'Context entity recall', 'Compare entities in retrieved context with the ground-truth answer.', '/solutions/quality/evaluators', 'Manage retrieval metrics', 'Add retained results and a clear unsupported state when local models cannot perform the metric.', [
        'yes', 'Ragas 0.2.6 provides ContextEntityRecall.', 'yes', 'The sidecar exposes context_entity_recall and degrades by omitting failed metrics.', 'yes', 'The metric is represented in the evaluator catalog.', 'partial', 'The path is wired, but production execution evidence is not retained.',
      ]),
      capability('datasets-experiments', 'Datasets, experiments, and result history', 'Version evaluation datasets, compare runs, and inspect per-sample scores over time.', '/solutions/quality/runs', 'Inspect quality runs', 'Ragas is used as a stateless scorer; add console-owned dataset/version provenance and persisted engine-attributed result history.', [
        'yes', 'Ragas supports dataset evaluation and returns per-row/aggregate results.', 'partial', 'The console assembles golden samples and persists normalized eval results, but the sidecar returns only a metric map.', 'partial', 'Quality Runs shows console results without full Ragas experiment provenance.', 'partial', 'Golden workflows use the scorer conditionally; complete per-sample history is not available.',
      ]),
    ],
  },
  {
    serviceId: 'victoriametrics',
    serviceLabel: 'VictoriaMetrics',
    upstreamVersion: 'v1.106.1',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource:
      'https://docs.victoriametrics.com/victoriametrics/; https://github.com/VictoriaMetrics/VictoriaMetrics/tree/v1.106.1',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'VictoriaMetrics query and OTLP/remote-write paths are configured, but the fleet currently has zero application series. Storage health is not production telemetry coverage.',
    items: [
      capability('metrics-query', 'Metrics query and range analysis', 'Query current and historical time series with PromQL-compatible expressions.', '/operations/health/metrics/explorer', 'Open metric explorer', 'The explorer + saved-query CRUD are live-verified, but the deployed VictoriaMetrics currently holds zero application series (no scrape targets configured — not even self-metrics), so a real metric VALUE has not been read end-to-end. Configuring VM scraping is a fleet/deploy concern outside the console; real values will render here once VM ingests.', [
        'yes', 'VictoriaMetrics 1.106.1 exposes Prometheus-compatible instant and range query APIs.', 'yes', 'The victoriametrics adapter runs bounded instant/range PromQL queries + /label/__name__/values against the live VM (verified: query executes, returns a well-formed empty result because VM is empty).', 'yes', 'Operations → Platform health → Metrics is a live PromQL explorer (query, range, metric-name picker, chart) with a console-owned saved-query panel; saved-query CRUD is fleet-proven live (create→list→delete of "up-probe" in real org-scoped Postgres).', 'no', 'Deployed ≠ used: no real metric value has been read because the deployed VM has zero application series; the query path is verified to execute but returns empty until VM ingests.',
      ]),
      capability('ingest-remote-write', 'Prometheus remote write and OTLP ingestion', 'Accept application and collector metrics through remote-write or OTLP paths.', '/operations/health/metrics', 'Inspect metrics health', 'Transport configuration exists, but no recurring application emitter is verified. Correlate accepted samples with named producers.', [
        'yes', 'VictoriaMetrics accepts Prometheus remote write and supported OTLP ingestion paths.', 'partial', 'Collector/static configuration targets the store, but accepted-sample attribution is absent.', 'yes', 'Operations exposes destination health and query results.', 'no', 'No verified production producer sends application series.',
      ]),
      capability('alerts-recording-rules', 'Alerts and recording rules', 'Create rule groups, evaluate alerts, and inspect firing state.', '/operations/health/metrics/alerts', 'Inspect alerts', 'Rule + firing state are READ from the live vmalert API (engineDeployed confirmed); rule-group authoring is not exposed because vmalert rule definitions are file-provisioned at deploy, not console-writable. No rules are currently configured to prove firing.', [
        'yes', 'The VictoriaMetrics stack supports vmalert recording and alert rules.', 'partial', 'The adapter reads /api/v1/rules + /api/v1/alerts from the live vmalert (verified engineDeployed:true); no rule-write adapter (rules are deploy-owned file config).', 'partial', 'The Alerts tab lists recording/alerting rules + firing alerts with a summary; no rule-authoring UI.', 'no', 'No rules are currently deployed on the fleet vmalert, so firing/recording state cannot yet be shown against real rules.',
      ]),
      capability('retention-backup-cluster', 'Retention, backup, and cluster operations', 'Manage retention, snapshots, backups, tenancy, and distributed storage state.', '/operations/services/victoriametrics', 'Inspect VictoriaMetrics', 'The single-node service is probed only. Keep lifecycle in deployment records or add guarded backup/retention operations.', [
        'yes', 'VictoriaMetrics provides retention and backup tooling; distributed editions add cluster operations.', 'partial', 'The client checks/querys the store but does not manage lifecycle.', 'no', 'No retention, backup, or cluster UI exists.', 'no', 'No console workflow manages this state.',
      ]),
    ],
  },
  {
    serviceId: 'victorialogs',
    serviceLabel: 'VictoriaLogs',
    upstreamVersion: 'v1.3.2-victorialogs',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource:
      'https://docs.victoriametrics.com/victorialogs/; https://github.com/VictoriaMetrics/VictoriaMetrics/tree/v1.3.2-victorialogs/app/vlselect',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'VictoriaLogs contains live fleet logs and supports the operational log explorer. Ingestion attribution, retention, and alert/rule lifecycle remain incomplete.',
    items: [
      capability('log-query', 'Log search and field filtering', 'Search stored logs by time, text, stream, and structured fields.', '/operations/health/logs', 'Open platform logs', '', [
        'yes', 'VictoriaLogs 1.3.2 exposes LogsQL query and field APIs.', 'yes', 'The victorialogs adapter runs bounded time-window LogsQL queries, maps logical filter fields (service→service.name, level→severity) to the real schema, and normalizes records + hits histograms.', 'yes', 'Operations → Platform health → Logs is a live LogsQL search: composer, 15m/1h/24h/7d range, service/level dropdowns from field-values, volume histogram, expandable rows, honest read-only retention.', 'yes', 'Fleet-proven live: a LogsQL search over the on-prem VictoriaLogs returned a real record (service.name=offgrid-deployment-audit, severity INFO) with a matching histogram bucket, and the service dropdown populated from field-values — verified end-to-end through /operations/health/logs.',
      ]),
      capability('log-ingest', 'Structured log ingestion', 'Accept logs from supported HTTP, Loki, Elasticsearch, and OpenTelemetry-compatible paths.', '/operations/health/logs', 'Inspect log delivery', 'Live logs exist, but producer/transport attribution is incomplete. Record the ingest path and delivery failures per source.', [
        'yes', 'VictoriaLogs supports multiple structured log ingestion protocols.', 'partial', 'Forwarders send fleet logs, while the OTel Collector log pipeline is not proven to target VictoriaLogs.', 'yes', 'The log explorer shows stored records.', 'partial', 'Fleet logs are live; complete application and collector source coverage is not verified.',
      ]),
      capability('streams-facets-stats', 'Streams, facets, and statistics', 'Explore stream cardinality, field values, and aggregate log statistics.', '/operations/health/logs', 'Explore platform logs', 'The adapter focuses on normalized records. Add bounded facet/stat APIs and cardinality safeguards before exposing the full query surface.', [
        'yes', 'VictoriaLogs provides stream and query-statistics operations.', 'partial', 'Basic fields are normalized, but the full facet/stat API is not adapted.', 'partial', 'Filters exist without a complete stream/facet workbench.', 'partial', 'Operators investigate logs, while advanced aggregate workflows are not verified.',
      ]),
      capability('retention-alerts-tenancy', 'Retention, alerts, and tenant operations', 'Manage retention, alert rules, tenant boundaries, and storage lifecycle.', '/operations/health/logs', 'Open platform logs', 'Retention is surfaced read-only (single-node VictoriaLogs retention is a deploy flag, not console-writable); alert rules and multi-tenant boundaries are not yet exposed. Add those adapters if tenant-safe configuration + rollback is designed.', [
        'yes', 'VictoriaLogs supports retention controls and integrations for alert evaluation.', 'partial', 'The adapter reads effective retention from /flags and surfaces it; no alert-rule or tenant-management adapter exists.', 'partial', 'The Logs page shows a read-only retention panel (period + honest deploy-flag note); no alert-rule or tenant management UI.', 'no', 'Retention is read-only by nature here and no production workflow manages alerts or tenant boundaries through the console.',
      ]),
    ],
  },
  stale({
    serviceId: 'otel-collector',
    serviceLabel: 'OpenTelemetry Collector',
    upstreamVersion: '0.116.0 (stale; deployed fleet 0.156.0)',
    versionSource: `deploy/docker-compose.yml; ${FLEET_RECORD}`,
    denominatorSource:
      'https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/v0.116.0; https://opentelemetry.io/docs/collector/configuration/',
    auditedAt: AUDITED_AT,
    auditState: 'stale',
    auditStateEvidence:
      'The fleet replaced 0.116.0 with 0.156.0. Deployment records prove an OTLP trace round-trip on 0.156.0 but do not re-audit that release capability-by-capability.',
    summary:
      'OTLP trace and log transport is fleet-proven and static pipelines target Jaeger and logging backends. Application metrics remain a producer gap.',
    items: [
      capability('otlp-traces', 'OTLP trace ingest', 'Receive OTLP/HTTP and OTLP/gRPC traces.', '/operations/services/otel-collector', 'Inspect collector readiness', 'Persist per-run collector delivery receipts and re-audit the deployed release.', [
        'yes', 'The contrib collector ships OTLP HTTP and gRPC receivers.', 'yes', 'emitSpan and readiness probes post valid OTLP/HTTP envelopes.', 'yes', 'Service detail reports ingest acceptance.', 'yes', 'The fleet record proves an OTLP trace traversed the collector and was retrieved from Jaeger.',
      ]),
      capability('trace-export-jaeger', 'Trace export to Jaeger', 'Batch accepted traces and export them to Jaeger OTLP.', '/operations/health/traces', 'Open trace explorer', 'Add durable correlation and exporter-failure state per application run.', [
        'yes', 'The collector supports OTLP exporters.', 'partial', 'A static deployment config owns the exporter rather than a runtime adapter.', 'yes', 'Platform Health reads Jaeger traces.', 'yes', 'A correlated fleet probe trace was retrieved from Jaeger.',
      ]),
      capability('otlp-metrics', 'OTLP metrics and remote write', 'Receive metrics and export them to VictoriaMetrics.', '/operations/health/metrics', 'Open platform metrics', 'Add a recurring application metric producer and correlate accepted/exported sample counts.', [
        'yes', 'The collector supports OTLP metrics and Prometheus remote write.', 'partial', 'Static config wires the pipeline and an audit exporter can push metrics.', 'yes', 'Platform Health reads VictoriaMetrics.', 'no', 'The fleet reports zero application series.',
      ]),
      capability('otlp-logs', 'OTLP log ingest and export', 'Receive structured logs and deliver them to an operational backend.', '/operations/health/logs', 'Open platform logs', 'Preserve tenant/correlation attribution and record which exporter delivered each source.', [
        'yes', 'The collector supports OTLP logs and multiple exporters.', 'partial', 'Fleet transport works, but the exact exporter path is static deployment configuration.', 'yes', 'Platform Logs reads live records.', 'yes', 'Fleet evidence proves OTLP log transport and live g5 logs.',
      ]),
      capability('readiness', 'Protocol-level ingest readiness', 'Verify that the OTLP receiver accepts a valid export envelope.', '/operations/services/otel-collector', 'Inspect readiness', 'Re-audit the 0.156.0 receiver behavior before treating this stale denominator as current.', [
        'yes', 'OTLP receivers acknowledge valid export requests.', 'yes', 'probeOtelReadiness posts valid empty resourceSpans.', 'yes', 'Services displays accepted, down, or unconfigured state.', 'yes', 'Operations health uses a protocol probe rather than a port check.',
      ]),
      capability('pipeline-configuration', 'Receiver, processor, and exporter configuration', 'Manage pipelines and approved signal destinations.', '/operations/services/otel-collector', 'Inspect collector', 'Keep committed YAML deployment-owned or add validated rollout and rollback; do not expose a raw editor.', [
        'yes', 'Collector pipelines compose receivers, processors, and exporters.', 'partial', 'One static config exists; no lifecycle adapter does.', 'no', 'No pipeline configuration UI exists.', 'no', 'No console workflow changes collector configuration.',
      ]),
      capability('processing-policies', 'Sampling, filtering, redaction, and routing', 'Apply telemetry policy before export.', '/operations/services/otel-collector', 'Inspect collector', 'Only batch is evidenced. Add explicit telemetry governance and end-to-end tests before sampling or redaction claims.', [
        'yes', 'The contrib collector includes sampling, filter, transform, and routing processors.', 'partial', 'The deployment evidence covers batch only.', 'no', 'No processing policy is visible or editable.', 'no', 'No production workflow applies governed telemetry processing.',
      ]),
      capability('self-telemetry', 'Collector throughput, errors, and queues', 'Inspect accepted signals, exporter failures, batches, and queue depth.', '/operations/health/metrics', 'Inspect collector metrics', 'Prove collector self-metrics reach VictoriaMetrics and back operational alerts.', [
        'yes', 'The collector emits receiver, processor, and exporter metrics.', 'partial', 'Queries exist without a verified self-telemetry export path.', 'yes', 'Platform Health has collector metric cards.', 'no', 'No verified alert or operation consumes collector self-metrics.',
      ]),
    ],
  }),
  {
    serviceId: 'jaeger',
    serviceLabel: 'Jaeger',
    upstreamVersion: '1.62.0',
    versionSource: 'deploy/docker-compose.yml',
    denominatorSource: 'https://www.jaegertracing.io/docs/1.62/apis/',
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'Jaeger trace ingestion and read-back are fleet-verified. Trace exploration is integrated; service dependencies, retention, and storage administration are not fully exposed.',
    items: [
      capability('trace-ingest', 'OTLP trace ingestion', 'Receive spans and assemble distributed traces.', '/operations/health/traces', 'Open trace explorer', '', [
        'yes', 'Jaeger 1.62 all-in-one accepts OTLP traces.', 'yes', 'The deployed collector exports traces to Jaeger.', 'yes', 'Platform Health exposes trace read-back.', 'yes', 'The fleet probe emitted a trace and retrieved it from Jaeger.',
      ]),
      capability('trace-search-detail', 'Trace search and span detail', 'Search by service, operation, tags, duration, and time and inspect span trees.', '/operations/health/traces', 'Explore traces', '', [
        'yes', 'Jaeger query APIs expose services, operations, traces, and span data.', 'yes', 'The jaeger adapter queries services/operations/traces/trace-detail and normalizes results (real error detection via error/otel.status_code/5xx, span-waterfall offsets/depth).', 'yes', 'Operations → Platform health → Traces is a URL-driven search (service/operation pickers, range, min-duration, errors-only) → span-waterfall detail with a Jaeger deep-link.', 'yes', 'Fleet-proven live: the service list came from the on-prem Jaeger (offgrid-console + 4 more), a 24h search returned 5 real offgrid-console traces, and trace fa55c1ea… rendered its audit.event.v2 span waterfall — verified through /operations/health/traces.',
      ]),
      capability('dependencies-performance', 'Service dependencies and performance analysis', 'Inspect dependency graphs, latency distributions, and error hotspots.', '/operations/health/traces', 'Inspect tracing', 'Core trace inspection is present; dependency and statistical views are not fully normalized or workflow-proven.', [
        'yes', 'Jaeger provides dependency and trace-derived performance views.', 'partial', 'The adapter focuses on service and trace queries, not the full dependency/statistics API.', 'partial', 'Trace detail exists without a complete dependency graph workbench.', 'partial', 'Incident investigation uses traces; dependency analysis is not verified.',
      ]),
      capability('storage-retention-admin', 'Storage, retention, and service administration', 'Configure storage backends, retention, archive, sampling, and collector/query topology.', '/operations/health/traces', 'Explore traces', 'Retention/storage/topology of the all-in-one deployment is configured outside the console (surfaced read-only); add guarded configuration + backup evidence to make it console-managed.', [
        'yes', 'Jaeger supports pluggable storage and deployment topology controls.', 'partial', 'Service health and query clients exist, but storage/config lifecycle does not.', 'partial', 'The Traces surface shows a read-only retention/storage note (deploy-owned); no retention, storage, or topology management UI.', 'no', 'No console workflow changes Jaeger service state.',
      ]),
    ],
  },
];

const ENTERPRISE_SOURCE_AUDITS: readonly ServiceCapabilityAudit[] = [
  stale({
    serviceId: 'enterprise-source-corebank',
    serviceLabel: 'Core Banking',
    upstreamVersion: '16-alpine (mutable image tag)',
    versionSource: '../onprem-fleet-orchestration/deploy/onprem/data-sources.yml',
    denominatorSource: ENTERPRISE_SOURCE_DENOMINATOR,
    auditedAt: AUDITED_AT,
    auditState: 'stale',
    auditStateEvidence:
      'The enterprise fixture uses the mutable postgres:16-alpine tag; the fleet records a healthy seeded source but not an immutable image digest.',
    summary:
      'The Core Banking PostgreSQL fixture is queryable through the SQL connector and supports lender and insurance context. Its mutable image identity prevents a current upstream audit.',
    items: [
      capability('sql-read', 'Governed SQL reads', 'Count and read approved Core Banking tables through a bound connector.', '/data/sources', 'Open data sources', 'Pin the fixture image and re-run schema, count, and bounded-read evidence against the immutable deployment.', [
        'yes', 'PostgreSQL 16 provides SQL table and metadata operations.', 'yes', 'connector-exec detects PostgreSQL and performs bounded read/count queries.', 'yes', 'Data Sources and connector detail expose test, resource, and query journeys.', 'yes', 'Fleet evidence records lender delinquency plus claims and policy lookups over the seeded source.',
      ]),
      capability('connector-lifecycle', 'Connector and credential lifecycle', 'Create, inspect, update, test, rotate credentials, and delete the source binding.', '/data/sources', 'Manage connector', 'The fixture is seed-owned and points to loopback; preserve a managed source identity and prove credential rotation without weakening the public-endpoint SSRF guard.', [
        'yes', 'PostgreSQL endpoints support credentialed connectivity and schema discovery.', 'partial', 'PostgreSQL connector CRUD is ready, but the internal fixture is seeded outside the public self-serve validation path.', 'yes', 'Data Sources provides create, detail, edit, test, secret, and delete controls.', 'partial', 'The seeded binding is used, but full fixture lifecycle and credential rotation are not fleet-proven.',
      ]),
      capability('schema-cdc-admin', 'Schema discovery, CDC, and database administration', 'Discover schemas, stream changes, and operate roles, backups, and maintenance.', '/data/flows/replication', 'Inspect replication', 'Schema reads exist and Airbyte batch sync is proven; source CDC and privileged database administration remain deployment-owned.', [
        'yes', 'PostgreSQL supports metadata discovery, logical replication, roles, and backup operations.', 'partial', 'Bounded SQL and Airbyte discovery exist; no connector adapter administers replication or roles.', 'partial', 'Replication shows source configuration without database administration.', 'partial', 'A CoreBank-to-ClickHouse batch sync is proven; CDC and administration are not.',
      ]),
    ],
  }),
  stale({
    serviceId: 'enterprise-source-policyadmin',
    serviceLabel: 'Policy Administration',
    upstreamVersion: '8 (mutable image tag)',
    versionSource: '../onprem-fleet-orchestration/deploy/onprem/data-sources.yml',
    denominatorSource: ENTERPRISE_SOURCE_DENOMINATOR,
    auditedAt: AUDITED_AT,
    auditState: 'stale',
    auditStateEvidence:
      'The enterprise fixture uses the mutable mysql:8 tag; the fleet records a healthy seeded source but not an immutable image digest.',
    summary:
      'The Policy Administration MySQL fixture is queryable through the SQL connector and used for reimbursement, advisor, and policy context.',
    items: [
      capability('sql-read', 'Governed SQL reads', 'Count and read approved policy-administration tables through a bound connector.', '/data/sources', 'Open data sources', 'Pin the MySQL image and re-run schema, count, and bounded-read proof.', [
        'yes', 'MySQL 8 provides SQL table and metadata operations.', 'yes', 'connector-exec detects MySQL and performs bounded read/count queries.', 'yes', 'Data Sources and connector detail expose query journeys.', 'yes', 'Fleet evidence records reimbursement, advisor, and policy operations over seeded data.',
      ]),
      capability('connector-lifecycle', 'Connector and credential lifecycle', 'Create, inspect, update, test, rotate credentials, and delete the binding.', '/data/sources', 'Manage connector', 'Prove lifecycle and secret rotation for the internal fixture without bypassing the SSRF policy.', [
        'yes', 'MySQL supports credentialed connectivity and schema discovery.', 'partial', 'MySQL connector CRUD is ready, but the internal fixture is seeded outside public self-serve validation.', 'yes', 'Data Sources exposes connector and secret management.', 'partial', 'The binding is used; fixture lifecycle and rotation are not fleet-proven.',
      ]),
      capability('schema-cdc-admin', 'Schema discovery, CDC, and database administration', 'Discover schemas, replicate changes, and operate users, backups, and maintenance.', '/data/flows/replication', 'Inspect replication', 'No current evidence proves policy-source CDC or privileged management through the console.', [
        'yes', 'MySQL 8 supports metadata, binlog CDC, users, and backup operations.', 'partial', 'Bounded SQL exists; advanced source administration does not.', 'partial', 'The source is visible without database administration.', 'no', 'No verified CDC or administration workflow exists for this fixture.',
      ]),
    ],
  }),
  stale({
    serviceId: 'enterprise-source-erp',
    serviceLabel: 'Finance ERP',
    upstreamVersion: 'latest (mutable image tag)',
    versionSource: '../onprem-fleet-orchestration/deploy/onprem/data-sources.yml',
    denominatorSource: ENTERPRISE_SOURCE_DENOMINATOR,
    auditedAt: AUDITED_AT,
    auditState: 'stale',
    auditStateEvidence:
      'The SQL Server fixture uses a mutable latest tag. Its seeded invoice workflow is recorded, but the exact running upstream release and digest are not.',
    summary:
      'The Finance ERP SQL Server fixture supports bounded invoice reads used by reimbursement validation. Immutable version evidence and broader administration are missing.',
    items: [
      capability('sql-read', 'Governed SQL reads', 'Count and read approved general-ledger and invoice tables.', '/data/sources', 'Open data sources', 'Pin the SQL Server image and re-run invoice, schema, count, and bounded-read proof.', [
        'yes', 'The deployed SQL Server family exposes T-SQL table queries.', 'yes', 'connector-exec detects mssql and performs bounded read/count queries.', 'yes', 'Data Sources and connector detail expose query journeys.', 'yes', 'Fleet evidence records reimbursement invoice validation over the seeded ERP.',
      ]),
      capability('connector-lifecycle', 'Connector and credential lifecycle', 'Create, inspect, update, test, rotate credentials, and delete the ERP binding.', '/data/sources', 'Manage connector', 'Prove lifecycle and secret rotation for the internal fixture and remove dependence on a mutable image.', [
        'yes', 'SQL Server supports credentialed connectivity and schema discovery.', 'partial', 'MSSQL connector CRUD is ready, while the loopback fixture is seed-owned.', 'yes', 'Data Sources exposes connector and secret management.', 'partial', 'The binding is used; full lifecycle and rotation are not fleet-proven.',
      ]),
      capability('schema-cdc-admin', 'Schema discovery, CDC, and database administration', 'Discover schemas, capture changes, and operate logins, backups, and maintenance.', '/data/flows/replication', 'Inspect replication', 'No verified ERP CDC, backup, login, or maintenance integration exists.', [
        'yes', 'SQL Server provides catalog, CDC, login, backup, and maintenance operations.', 'partial', 'Bounded SQL exists; advanced administration does not.', 'partial', 'The source is visible without database administration.', 'no', 'No verified advanced ERP workflow exists.',
      ]),
    ],
  }),
  {
    serviceId: 'enterprise-source-kafka',
    serviceLabel: 'Kafka-compatible Events',
    upstreamVersion: '24.2.7',
    versionSource: '../onprem-fleet-orchestration/deploy/onprem/data-sources.yml',
    denominatorSource: ENTERPRISE_SOURCE_DENOMINATOR,
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'The enterprise Kafka fixture is healthy and seeded, but the Data Sources connector catalog correctly marks Kafka as coming soon. Platform Redpanda tooling does not imply source integration.',
    items: [
      capability('source-produce-consume', 'Source event produce and consume', 'Publish and consume banking, claim, and CRM source events.', '/data/sources', 'Open data sources', 'Implement a tenant-scoped Kafka connector port with checkpointed offsets and delivery evidence; do not reuse an admin proof as a source adapter.', [
        'yes', 'Redpanda 24.2.7 provides Kafka-compatible producer and consumer protocols.', 'no', 'connector-policy marks Kafka coming-soon and connector-exec has no Kafka dialect.', 'partial', 'The source ontology is visible, but connector creation is deliberately disabled.', 'no', 'No registered product source consumes the seeded enterprise topics.',
      ]),
      capability('schemas-topics', 'Topic and schema discovery', 'Discover topics, partitions, schemas, and compatibility policy for source onboarding.', '/data/sources', 'Inspect source catalog', 'Wire source-scoped metadata and Schema Registry discovery with tenant boundaries.', [
        'yes', 'Redpanda provides Kafka metadata and Schema Registry APIs.', 'no', 'The Data Sources adapter does not implement Kafka metadata or schemas.', 'partial', 'Platform streaming has admin views, but source onboarding does not.', 'no', 'No source workflow binds a schema to this fixture.',
      ]),
      capability('offsets-security', 'Offsets, ACLs, and source operations', 'Manage durable offsets, lag, principals, ACLs, and quotas for ingestion.', '/data/sources', 'Inspect source', 'Add ownership-scoped groups, lag and reset safeguards, and authenticated ACL management.', [
        'yes', 'Kafka-compatible groups, offsets, ACLs, and quotas are available.', 'no', 'No source connector operations are integrated.', 'no', 'No source consumer or security workbench exists.', 'no', 'No production source workflow uses these operations.',
      ]),
    ],
  },
  {
    serviceId: 'enterprise-source-minio',
    serviceLabel: 'S3-compatible Data Lake',
    upstreamVersion: 'RELEASE.2025-04-08T15-41-24Z',
    versionSource: '../onprem-fleet-orchestration/deploy/onprem/data-sources.yml',
    denominatorSource: ENTERPRISE_SOURCE_DENOMINATOR,
    auditedAt: AUDITED_AT,
    auditState: 'current',
    auditStateEvidence: null,
    summary:
      'The pinned MinIO fixture is healthy and seeded, but the Data Sources connector catalog marks S3 as coming soon. No governed object workflow is proven.',
    items: [
      capability('object-read-write', 'Governed object read and write', 'List, read, write, and delete approved lake objects through a source binding.', '/data/sources', 'Open data sources', 'Implement an S3 connector port with bucket/key scoping, streaming limits, provenance, and real read/write evidence.', [
        'yes', 'The pinned MinIO release exposes S3-compatible object APIs.', 'no', 'connector-policy marks S3 coming-soon and connector-exec has no S3 dialect.', 'partial', 'The source ontology is visible, but S3 connector creation is disabled.', 'no', 'The fleet record explicitly has no governed object read/write evidence.',
      ]),
      capability('bucket-discovery', 'Bucket and object discovery', 'Discover buckets, prefixes, object metadata, and formats for onboarding.', '/data/sources', 'Inspect source catalog', 'Add credential-safe discovery and bounded previews without exposing arbitrary internal endpoints.', [
        'yes', 'MinIO provides bucket listing and object metadata APIs.', 'no', 'No source discovery adapter exists.', 'no', 'No bucket or prefix browser exists for this fixture.', 'no', 'No source onboarding workflow consumes discovery state.',
      ]),
      capability('versioning-retention-events', 'Versioning, retention, policies, and events', 'Manage object versions, lifecycle, retention, policies, and event notifications.', '/data/sources', 'Inspect source', 'Keep privileged lifecycle deployment-owned until tenant-safe policy, rollback, and audit boundaries are implemented.', [
        'yes', 'The pinned MinIO release provides versioning, lifecycle, retention, IAM policy, and notification APIs.', 'no', 'No adapter exposes these operations.', 'no', 'No corresponding management UI exists.', 'no', 'No production workflow manages them through the console.',
      ]),
    ],
  },
  stale({
    serviceId: 'enterprise-source-crm',
    serviceLabel: 'CRM',
    upstreamVersion: '20-alpine (mutable image tag)',
    versionSource: '../onprem-fleet-orchestration/deploy/onprem/data-sources.yml',
    denominatorSource: ENTERPRISE_SOURCE_DENOMINATOR,
    auditedAt: AUDITED_AT,
    auditState: 'stale',
    auditStateEvidence:
      'The CRM fixture uses the mutable node:20-alpine tag. Fleet records prove the REST fixture is healthy and used, but no immutable image digest identifies the audited deployment.',
    summary:
      'The Salesforce-style REST fixture supplies customer and cross-sell context. Governed task and opportunity writes are live through Apps with human approval, zero-mutation shadow execution, idempotent replay, and signed receipts. Receipt-correlated business-result evidence is code-wired but not yet deployed; immutable source identity and sync/webhook breadth remain gaps.',
    items: [
      capability('rest-read', 'Governed REST reads', 'Read approved account, opportunity, and contact resources.', '/data/sources', 'Open data sources', 'Pin the fixture and re-run resource discovery and bounded-read evidence.', [
        'yes', 'The deployed fixture exposes HTTP JSON resources.', 'yes', 'connector-exec detects REST/CRM endpoints and performs bounded reads.', 'yes', 'Data Sources and connector detail expose REST test and resource journeys.', 'yes', 'Fleet evidence records customer and cross-sell context lookup.',
      ]),
      capability('connector-lifecycle', 'Connector and credential lifecycle', 'Create, inspect, update, test, rotate credentials, and delete the CRM binding.', '/data/sources', 'Manage connector', 'Prove internal fixture lifecycle and secret rotation without bypassing endpoint safeguards.', [
        'yes', 'REST sources support endpoint and bearer/API-key lifecycle.', 'partial', 'REST connector CRUD is ready, while the loopback fixture is seed-owned.', 'yes', 'Data Sources exposes connector and secret management.', 'partial', 'The binding is used; full lifecycle and rotation are not fleet-proven.',
      ]),
      capability('write-sync-webhooks', 'Writes, pagination, sync, and webhooks', 'Create/update records, traverse pagination, perform incremental sync, and receive changes.', '/build/studio/new', 'Build governed CRM action', 'Deploy the checked-in outcome migration and retain a real CRM receipt → observed result → correction/withdrawal journey. Then add automatic system/import ingestion, portfolio baseline-versus-result reporting, typed pagination, incremental checkpoints, rate-limit handling, webhooks, and the remaining audited CRM CRUD lifecycle.', [
        'yes', 'Salesforce-style REST systems provide CRUD, pagination, incremental APIs, and webhooks/events.', 'partial', 'Existing bounded CRM adapters and the App action runtime execute tenant-scoped, allowlisted task/opportunity mutations with exact human approval, runtime-derived idempotency, signed receipts, and fail-closed internal endpoints. The code-wired Outcome Observation store resolves the canonical receipt server-side, appends tenant-scoped results, rejects conflicting source-event replay, and retains correction or withdrawal history. The migration is not deployed, and pagination, sync, automatic imports, and webhooks are not integrated.', 'partial', 'The nontechnical App builder configures a CRM action, reviewer, and impact preview. URL-driven run, result, correction, and withdrawal pages keep system completion separate from business success and preserve a read-only role state. Portfolio baseline-versus-result reporting plus CRM sync and webhook controls remain absent.', 'partial', 'Console SHA 16fa96443c79 completed Bharat App run apprun_5e715894: awaiting human approval, one approved CRM task mutation (count 0→1), retained reviewer/impact/signed receipt, duplicate approval rejected 409, and provider replay returned 200 without a second task. Shadow run apprun_71da60a4 completed with CRM count unchanged at 1. Outcome contract, real PostgreSQL route/store, and rendered UI tests are green in source, but no deployed business-result observation is retained yet.',
      ]),
    ],
  }),
];

export const DATA_QUALITY_OBSERVABILITY_AUDITS: readonly ServiceCapabilityAudit[] = [
  ...DATA_AUDITS,
  ...OBSERVABILITY_AUDITS,
  ...ENTERPRISE_SOURCE_AUDITS,
];

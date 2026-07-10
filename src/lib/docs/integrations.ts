import type { DocSection } from './types';

export const integrationsSection: DocSection = {
  id: 'integrations',
  label: 'Integrations',
  pages: [
    {
      slug: 'integrations/catalog',
      title: 'Integration catalog',
      description: 'Every data source and service Off Grid AI connects to.',
      body: `Off Grid AI connects to your systems on two sides: **data sources** you pull knowledge from,
and **platform services** that back the capabilities. Every one runs on your infrastructure or your
own accounts.

![Integrations - every data source and swappable platform service Off Grid AI connects to](/docs-shots/integrations.png)

## Data source connectors

Add these on the **Integrations** page - point at an endpoint, choose an auth scheme, sync.

- **PostgreSQL** - relational OLTP/OLAP databases.
- **MySQL** - relational databases.
- **Microsoft SQL Server** - enterprise relational.
- **S3-compatible object storage** - data-lake / warehouse buckets (MinIO, etc.).
- **Kafka** - event streams (Redpanda-compatible).
- **REST / HTTP** - any JSON API (CRM, internal services).
- **Custom (MCP or HTTP)** - register your own tool server or endpoint as a governed connector.

Sync reports real row/document counts from the live source. See [Data](/docs/guides/data).

## Platform services (swappable)

Each capability is reached through a port, so you can swap the implementation with one environment
variable. Defaults run first-party; these are the production swap-ins:

![Swap any backend through a capability port - one environment variable, first-party fallback always ready](/docs-shots/connectors.png)

- **Identity / SSO** - point the adapter at your identity provider (e.g. Keycloak).
- **Vector store** - retrieval index at scale (embedded store is the default; e.g. Qdrant).
- **Secrets store** - a KV vault for connector credentials and keys (e.g. OpenBao).
- **PII detection** - entity-grade detection + anonymization (e.g. Presidio).
- **Policy engine** - policy-as-code at scale (e.g. OPA).
- **Tracing / observability** - trace store for runs and costs (e.g. Langfuse).
- **Data lineage** - source-to-answer lineage store (e.g. Marquez / OpenLineage).
- **Audit / security event index** - searchable event store (e.g. OpenSearch).
- **Dashboards / BI** - analytics dashboards (e.g. Superset).
- **Feature flags** - runtime capability gating (e.g. Unleash).
- **Device management** - fleet inventory + posture, e.g. FleetDM (device control commands like lock and wipe are coming soon).
- **Workflow engine** - durable agent workflows (e.g. Temporal).
- **Object storage** - file/artifact store (e.g. SeaweedFS).

Browse the OpenAPI spec for any of these from **API docs & playground** in the console.`,
    },
  ],
};

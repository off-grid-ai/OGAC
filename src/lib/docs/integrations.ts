import type { DocSection } from './types';

export const integrationsSection: DocSection = {
  id: 'integrations',
  label: 'Integrations',
  pages: [
    {
      slug: 'integrations/catalog',
      title: 'Integration catalog',
      description: 'Every data source and service Off Grid connects to.',
      body: `Off Grid connects to your systems on two sides: **data sources** you pull knowledge from,
and **platform services** that back the capabilities. Every one runs on your infrastructure or your
own accounts.

## Data source connectors

Add these on the **Integrations** page — point at an endpoint, choose an auth scheme, sync.

- **PostgreSQL** — relational OLTP/OLAP databases.
- **MySQL** — relational databases.
- **Microsoft SQL Server** — enterprise relational.
- **S3-compatible object storage** — data-lake / warehouse buckets (MinIO, etc.).
- **Kafka** — event streams (Redpanda-compatible).
- **REST / HTTP** — any JSON API (CRM, internal services).
- **Custom (MCP or HTTP)** — register your own tool server or endpoint as a governed connector.

Sync reports real row/document counts from the live source. See [Data](/docs/guides/data).

## Platform services (swappable)

Each capability is reached through a port, so you can swap the implementation with one environment
variable. Defaults run first-party; these are the production swap-ins:

- **Keycloak** — identity / SSO.
- **Qdrant** — vector store for retrieval (embedded store is the default).
- **OpenBao** — secrets vault.
- **Presidio** — PII detection + anonymization.
- **OPA** — policy-as-code.
- **Langfuse** — LLM tracing / observability.
- **Marquez** — data lineage (OpenLineage).
- **OpenSearch** — audit/security event index.
- **Superset** — BI dashboards.
- **Unleash** — feature flags.
- **FleetDM** — device management.
- **Temporal** — durable agent workflows.
- **SeaweedFS** — object storage.

Browse the OpenAPI spec for any of these from **API docs & playground** in the console.`,
    },
  ],
};

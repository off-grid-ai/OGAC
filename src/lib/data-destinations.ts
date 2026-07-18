export const FLOW_DESTINATIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Choose a replication sync or orchestrated job and inspect data-plane health.',
    route: '/data/flows',
  },
  {
    id: 'replication',
    label: 'Replication',
    description: 'Run connector syncs and inspect their recent movement history.',
    route: '/data/flows/replication',
  },
  {
    id: 'orchestration',
    label: 'Orchestration',
    description: 'Create, schedule, run, and inspect mapped warehouse jobs.',
    route: '/data/flows/orchestration',
  },
] as const;

export const WAREHOUSE_DESTINATIONS = [
  {
    id: 'tables',
    label: 'Tables',
    description: 'Inspect warehouse tables, columns, row counts, size, freshness, and quality.',
    route: '/data/warehouse',
  },
  {
    id: 'query',
    label: 'Query',
    description: 'Explore warehouse data with read-only SQL.',
    route: '/data/warehouse/query',
  },
] as const;

export const CATALOG_DESTINATIONS = [
  {
    id: 'assets',
    label: 'Assets',
    description: 'Manage catalogued datasets, ownership, classifications, and freshness.',
    route: '/data/catalog',
  },
  {
    id: 'governance',
    label: 'Governance',
    description: 'Manage masking, erasure, scanning, and retention controls for enterprise data.',
    route: '/data/catalog/governance',
  },
] as const;

export const KNOWLEDGE_DESTINATIONS = [
  {
    id: 'collections',
    label: 'Collections',
    description: 'Curate permission-aware knowledge collections and their documents.',
    route: '/data/knowledge',
  },
  {
    id: 'indexes',
    label: 'Indexes',
    description: 'Inspect and manage collections on the active retrieval index.',
    route: '/data/knowledge/indexes',
  },
] as const;

type DataDestination =
  | (typeof FLOW_DESTINATIONS)[number]
  | (typeof WAREHOUSE_DESTINATIONS)[number]
  | (typeof CATALOG_DESTINATIONS)[number]
  | (typeof KNOWLEDGE_DESTINATIONS)[number];

export type DataDestinationId = DataDestination['id'];

export function dataDestination<Destination extends DataDestination>(
  destinations: readonly Destination[],
  rawId: string | null | undefined,
): Destination | undefined {
  return destinations.find((candidate) => candidate.id === rawId);
}

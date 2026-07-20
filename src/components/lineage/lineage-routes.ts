export type LineageSearchParams = Readonly<Record<string, string | string[] | undefined>>;

export const LINEAGE_DESTINATIONS = [
  {
    id: 'graph',
    label: 'Graph',
    description: 'Dataset and job relationships from the lineage store.',
    route: '/data/lineage/graph',
  },
  {
    id: 'datasets',
    label: 'Datasets',
    description: 'Dataset schema, facets, tags, and curation.',
    route: '/data/lineage/datasets',
  },
  {
    id: 'runs',
    label: 'Runs',
    description: 'Source-to-answer lineage for grounded executions.',
    route: '/data/lineage/runs',
  },
] as const;

function serializedSearchParams(searchParams: LineageSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (rawValue === undefined) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) query.append(key, value);
  }
  return query.toString();
}

/**
 * Preserve legacy Lineage bookmarks while moving the module root to a durable destination.
 * Dataset detail links land on the dataset collection; every other root visit lands on the graph.
 */
export function canonicalLineagePath(searchParams: LineageSearchParams): string {
  const destination = searchParams.dataset
    ? LINEAGE_DESTINATIONS[1].route
    : LINEAGE_DESTINATIONS[0].route;
  const query = serializedSearchParams(searchParams);
  return `${destination}${query ? `?${query}` : ''}`;
}

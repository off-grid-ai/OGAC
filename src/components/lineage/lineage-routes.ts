export type LineageSearchParams = Readonly<Record<string, string | string[] | undefined>>;

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
  const destination = searchParams.dataset ? 'datasets' : 'graph';
  const query = serializedSearchParams(searchParams);
  return `/data/lineage/${destination}${query ? `?${query}` : ''}`;
}

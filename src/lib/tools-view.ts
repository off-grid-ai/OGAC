// ─── Tools catalog filter model (PURE, zero-IO) ───────────────────────────────────────────────────
// Level-3 navigation is owned by modules/contextual-navigation.ts. Query parameters here only
// filter the Catalog destination; they never select a navigational place.
// A catalog server matches iff (a) its category equals the selected category (or no category filter)
// AND (b) the free-text query appears in its name / description / category (case-insensitive). Used
// to filter the 18-server catalog. Kept pure + generic over the minimal shape it reads.
export interface CatalogSearchable {
  name: string;
  description: string;
  category: string;
}

export function matchesCatalogQuery(
  server: CatalogSearchable,
  query: string,
  category: string | null,
): boolean {
  if (category && server.category !== category) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    server.name.toLowerCase().includes(q) ||
    server.description.toLowerCase().includes(q) ||
    server.category.toLowerCase().includes(q)
  );
}

export function filterCatalog<T extends CatalogSearchable>(
  servers: T[],
  query: string,
  category: string | null,
): T[] {
  return servers.filter((s) => matchesCatalogQuery(s, query, category));
}

// ─── Tools home view model (Builder Epic #121) — PURE, zero-IO ────────────────────────────────────
//
// ONE Tools surface under Build unifies the three formerly-scattered tool surfaces:
//   • Registered — the HTTP/MCP tool registry (full CRUD), formerly Brain "Tools & services".
//   • Catalog    — the curated MCP catalog to one-click add from, formerly the orphaned /tool-catalog.
//   • Primitives — the built-in web_search / read_url / http primitives + their air-gap state.
//
// The active tab lives in the URL (?tab=) so it's deep-linkable and Back-coherent. This module holds
// only the pure tab vocabulary + the catalog search/filter predicate — no React, no I/O — so both are
// unit-testable in isolation (test/tools-view.test.ts).

export const TOOLS_TABS = ['registered', 'catalog', 'primitives'] as const;
export type ToolsTab = (typeof TOOLS_TABS)[number];
export const DEFAULT_TOOLS_TAB: ToolsTab = 'registered';

// Normalize an arbitrary ?tab= value to a known tab, defaulting to Registered. Guards deep-links.
export function normalizeToolsTab(raw: string | undefined | null): ToolsTab {
  return TOOLS_TABS.includes(raw as ToolsTab) ? (raw as ToolsTab) : DEFAULT_TOOLS_TAB;
}

// ─── Catalog search/filter predicate (PURE) ───────────────────────────────────────────────────────
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

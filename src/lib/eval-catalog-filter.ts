// PURE filter/sort/facet logic for the evaluator-template catalog — ZERO imports, ZERO I/O, so it is
// unit-testable in isolation (node --test, type-stripped). The catalog UI (EvalTemplateCatalog)
// fetches the enriched templates and drives all search/filter/sort through these functions; the
// component stays thin and its state is URL-navigational.
//
// A "catalog template" here is the shape the /api/v1/admin/eval-templates route returns: the base
// EvalTemplate plus the honest availability badge. We model only the fields we filter/sort on so this
// module never depends on eval-templates.ts.

export interface CatalogTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  metric: string;
  method: string;
  engine: string;
  direction: 'higher-better' | 'lower-better';
  defaultThreshold: number;
  availability: { available: boolean; degraded: boolean; detail: string };
}

// The knobs the operator turns. All optional / empty = no constraint. `q` matches name + description
// (case-insensitive substring). `category` / `engine` are exact-match single-select (empty = all).
export interface CatalogFilter {
  q?: string;
  category?: string;
  engine?: string;
}

export type CatalogSortKey = 'name' | 'category' | 'engine' | 'threshold';

// The facets available for the chip/select controls, derived FROM the catalog (never a stale
// hardcoded list). Each facet carries a count so the UI can show "RAG (5)". Sorted for a stable,
// scannable order: categories & engines alphabetically by their id.
export interface Facet {
  value: string;
  count: number;
}
export interface CatalogFacets {
  categories: Facet[];
  engines: Facet[];
}

// True when any constraint is active. The UI uses this to decide grouped-by-category (idle) vs.
// flat filtered results (active).
export function isFilterActive(filter: CatalogFilter): boolean {
  return Boolean(filter.q?.trim()) || Boolean(filter.category) || Boolean(filter.engine);
}

// Case-insensitive substring match on name + description.
function matchesQuery(t: CatalogTemplate, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return t.name.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle);
}

// Apply search + category + engine. Preserves input order (the caller sorts separately). Pure — never
// mutates the input array.
export function filterTemplates(
  templates: readonly CatalogTemplate[],
  filter: CatalogFilter,
): CatalogTemplate[] {
  const q = filter.q ?? '';
  return templates.filter((t) => {
    if (!matchesQuery(t, q)) return false;
    if (filter.category && t.category !== filter.category) return false;
    if (filter.engine && t.engine !== filter.engine) return false;
    return true;
  });
}

// Stable sort by the chosen key. Ties break by name so the order is deterministic. `threshold` sorts
// descending (highest bar first) since that's the more useful default when scanning strictness;
// everything else ascending alphabetically. Pure — returns a new array.
export function sortTemplates(
  templates: readonly CatalogTemplate[],
  sortKey: CatalogSortKey,
): CatalogTemplate[] {
  const byName = (a: CatalogTemplate, b: CatalogTemplate) => a.name.localeCompare(b.name);
  const copy = [...templates];
  switch (sortKey) {
    case 'name':
      copy.sort(byName);
      break;
    case 'category':
      copy.sort((a, b) => a.category.localeCompare(b.category) || byName(a, b));
      break;
    case 'engine':
      copy.sort((a, b) => a.engine.localeCompare(b.engine) || byName(a, b));
      break;
    case 'threshold':
      copy.sort((a, b) => b.defaultThreshold - a.defaultThreshold || byName(a, b));
      break;
  }
  return copy;
}

// Derive the category + engine facets (with counts) present in THIS catalog. Sorted by value so the
// chip row is stable regardless of template insertion order. Nothing is hardcoded — add a template in
// a new category and its chip appears automatically.
export function catalogFacets(templates: readonly CatalogTemplate[]): CatalogFacets {
  const cat = new Map<string, number>();
  const eng = new Map<string, number>();
  for (const t of templates) {
    cat.set(t.category, (cat.get(t.category) ?? 0) + 1);
    eng.set(t.engine, (eng.get(t.engine) ?? 0) + 1);
  }
  const toFacets = (m: Map<string, number>): Facet[] =>
    [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  return { categories: toFacets(cat), engines: toFacets(eng) };
}

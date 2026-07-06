// Pure categorization for the Integrations adapter catalog. Zero-IO, unit-testable: it maps each
// capability port to a functional category so the (otherwise flat) adapter grid can be filtered
// behind a sub-nav. Kept separate from the registry (which does the I/O/health probing) per the
// SOLID split — this file only knows the taxonomy, not how bindings are fetched.
import type { Capability } from './types';

export interface AdapterCategory {
  // Stable slug used in the ?cat= URL param — deep-linkable, lowercase, no spaces.
  id: string;
  label: string;
  // Capabilities that belong to this category, in display order.
  capabilities: Capability[];
}

// The default view when no ?cat= is set: show every adapter.
export const ALL_CATEGORY_ID = 'all';

// Categories by function. Every capability in the registry belongs to exactly one category; the
// order here is the sub-nav tab order (after the "All" tab, which shows everything). Grouping is
// by what the operator is doing, not by vendor: what the model retrieves against, what runs it,
// what watches it, what keeps it safe/attested, how it's judged, where its data/telemetry lands,
// the fleet it runs on, and where untrusted code executes.
export const ADAPTER_CATEGORIES: AdapterCategory[] = [
  {
    id: 'retrieval',
    label: 'Retrieval',
    // What answers are grounded against + the cache in front of it.
    capabilities: ['retrieval', 'grounding', 'caching'],
  },
  {
    id: 'inference',
    label: 'Inference',
    // The gateway that runs the model + the flags that gate its behavior.
    capabilities: ['inference', 'flags'],
  },
  {
    id: 'observability',
    label: 'Observability',
    // Watching the model run: traces/metrics + drift detection.
    capabilities: ['observability', 'drift'],
  },
  {
    id: 'security-provenance',
    label: 'Security & Provenance',
    // Keeping it safe and attested: secrets, guardrails, policy, identity, audit, signing, lineage.
    capabilities: ['secrets', 'guardrails', 'policy', 'identity', 'siem', 'provenance', 'lineage'],
  },
  {
    id: 'eval',
    label: 'Eval',
    // How the model is judged.
    capabilities: ['evals'],
  },
  {
    id: 'data-bi',
    label: 'Data & BI',
    // Where data/telemetry lands for analysis.
    capabilities: ['bi'],
  },
  {
    id: 'devices',
    label: 'Devices',
    // The fleet the stack runs on.
    capabilities: ['mdm'],
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    // Where untrusted / agent-generated code executes.
    capabilities: ['sandbox'],
  },
];

// Reverse lookup: capability -> category id.
const CAP_TO_CATEGORY: Partial<Record<Capability, string>> = Object.fromEntries(
  ADAPTER_CATEGORIES.flatMap((c) => c.capabilities.map((cap) => [cap, c.id] as const)),
);

// The category id for a capability. A newly-added capability with no mapping falls into a
// synthetic "other" bucket so it's never silently dropped from the grid.
export function categoryForCapability(capability: Capability): string {
  return CAP_TO_CATEGORY[capability] ?? 'other';
}

// Normalize an arbitrary ?cat= value into a known category id (or ALL). Unknown/absent -> ALL.
export function normalizeCategory(raw: string | null | undefined): string {
  if (!raw || raw === ALL_CATEGORY_ID) return ALL_CATEGORY_ID;
  return ADAPTER_CATEGORIES.some((c) => c.id === raw) ? raw : ALL_CATEGORY_ID;
}

// Filter a list of capability-tagged items to the active category. ALL returns everything.
export function filterByCategory<T extends { capability: Capability }>(
  items: T[],
  categoryId: string,
): T[] {
  const cat = normalizeCategory(categoryId);
  if (cat === ALL_CATEGORY_ID) return items;
  return items.filter((i) => categoryForCapability(i.capability) === cat);
}

// Count of items per category id (used to badge / hide empty tabs). Includes an "all" key.
export function categoryCounts<T extends { capability: Capability }>(
  items: T[],
): Record<string, number> {
  const counts: Record<string, number> = { [ALL_CATEGORY_ID]: items.length };
  for (const item of items) {
    const id = categoryForCapability(item.capability);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

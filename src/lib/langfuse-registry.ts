// Pure, server-safe registry-tab helpers for the Langfuse registry panel. Extracted out of the
// 'use client' component so the server page (observability/page.tsx) can import resolveRegistryTab
// WITHOUT pulling a client module across the RSC boundary (which throws:
// "Attempted to call resolveRegistryTab() from the server but it is on the client").
// Zero-import, no hooks — safe on both server and client.

export const REGISTRY_TABS = ['prompts', 'datasets', 'sessions'] as const;
export type RegistryTab = (typeof REGISTRY_TABS)[number];
export const DEFAULT_REGISTRY_TAB: RegistryTab = 'prompts';

// URL param (?lfReg) → a valid tab, defaulting to prompts. Nav-in-URL, deep-linkable.
export function resolveRegistryTab(raw: string | undefined): RegistryTab {
  return REGISTRY_TABS.includes(raw as RegistryTab) ? (raw as RegistryTab) : DEFAULT_REGISTRY_TAB;
}

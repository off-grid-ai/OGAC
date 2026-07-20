import { redirect } from 'next/navigation';

const LEGACY_POLICY_DESTINATIONS: Readonly<Record<string, string>> = {
  abac: '/governance/policies/rules',
  rules: '/governance/policies/rules',
  templates: '/governance/policies/templates',
  rego: '/governance/policies/modules',
  modules: '/governance/policies/modules',
  decisions: '/governance/policies/decisions',
  overview: '/governance/policies/overview',
};

/** Preserve old authoring-tab bookmarks, then land on the canonical policy overview. */
export default async function PoliciesRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<{ tab?: string }> }>) {
  const { tab } = await searchParams;
  redirect((tab && LEGACY_POLICY_DESTINATIONS[tab]) || '/governance/policies/overview');
}

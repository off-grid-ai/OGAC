// ─── Who routes through a data domain — PURE ───────────────────────────────────────────────────────
//
// `/data/domains` listed 42 near-identical rule cards with no way to tell which ones the org actually
// runs on. Two rows covering the same kind of data ("customer data" and "crm accounts") are impossible
// to choose between when the page shows only their bindings, and Delete was offered with no hint that
// three apps route through the rule you are about to remove — the exact trap that broke apps when the
// duplicate system pipelines were deleted without repointing references first.
//
// So: the reverse edge. Which apps bind this domain in a connector-query step, and which pipelines
// allowlist it. Matching uses the SAME token set the pipeline ceiling uses (`domainMatchTokens`: id ∪
// label ∪ aliases, normalised) because a step may bind a domain by id OR by label — both shapes are in
// the seeded data — and a second matching rule here would drift from the one enforcement uses.
//
// Zero I/O: callers pass the already-read apps/pipelines.

import { domainMatchTokens, normalizeRefToken, type DomainRefTokens } from '@/lib/pipelines-policy';

/** The little of an app this module needs: its identity plus the steps that can carry a domain. */
export interface AppLike {
  id: string;
  title: string;
  steps: { kind: string; domain?: string }[];
}

export interface DomainUsage {
  /** Apps with at least one connector-query step bound to this domain. */
  apps: { id: string; title: string }[];
  /** Pipelines whose data ceiling allowlists it. */
  pipelines: { id: string; name: string }[];
  /** True when nothing routes through the rule — safe to delete, and worth flagging on the card. */
  unused: boolean;
}

/** Every domain reference carried by an app's steps, normalised. */
export function appDomainRefs(app: AppLike): string[] {
  return (app.steps ?? [])
    .filter((s) => s.kind === 'connector-query')
    .map((s) => normalizeRefToken(s.domain))
    .filter((t) => t.length > 0);
}

/** Apps that route through `domain`, in the order given. */
export function appsUsingDomain(apps: AppLike[], domain: DomainRefTokens): AppLike[] {
  const want = new Set(domainMatchTokens(domain));
  if (!want.size) return [];
  return apps.filter((a) => appDomainRefs(a).some((ref) => want.has(ref)));
}

/**
 * The full reverse edge for one domain. `pipelines` is passed already-filtered by the caller (the
 * pipeline store owns that query and its enrichment); this composes it with the app side so both the
 * card and the detail page read one shape.
 */
export function domainUsage(
  domain: DomainRefTokens,
  apps: AppLike[],
  pipelines: { id: string; name: string }[],
): DomainUsage {
  const used = appsUsingDomain(apps, domain).map((a) => ({ id: a.id, title: a.title }));
  return { apps: used, pipelines, unused: used.length === 0 && pipelines.length === 0 };
}

/**
 * One line of English for a card: "3 apps · 2 pipelines", or the honest empty state. Kept here rather
 * than in the component so the wording is identical everywhere and testable.
 */
export function describeUsage(usage: DomainUsage): string {
  if (usage.unused) return 'Not routed to yet';
  const parts: string[] = [];
  if (usage.apps.length) parts.push(`${usage.apps.length} app${usage.apps.length === 1 ? '' : 's'}`);
  if (usage.pipelines.length) {
    parts.push(`${usage.pipelines.length} pipeline${usage.pipelines.length === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

/**
 * What deleting this rule would break, as a sentence for the confirmation dialog. Empty string when
 * nothing references it — the caller then shows the plain confirmation.
 */
export function describeDeleteImpact(usage: DomainUsage): string {
  if (usage.unused) return '';
  const names = [
    ...usage.apps.map((a) => a.title),
    ...usage.pipelines.map((p) => p.name),
  ];
  const shown = names.slice(0, 3).join(', ');
  const rest = names.length - Math.min(3, names.length);
  const tail = rest > 0 ? ` and ${rest} more` : '';
  return `${shown}${tail} route through this rule. Deleting it leaves those bindings pointing at nothing — repoint them first.`;
}

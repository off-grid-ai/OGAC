// ─── Tenant ownership in the AI-observability store (PURE — zero imports) ─────────────────────────
//
// WHY THIS EXISTS. The observability read layer had no tenant awareness of any kind: every function in
// langfuse.ts took a `limit` and nothing else. On the live deployment that meant
// /insights/ai/traces, /insights/ai/langfuse-prompts, /insights/ai/langfuse-datasets and
// /insights/ai/overview returned BYTE-IDENTICAL data on both demo tenants — and opening the prompt from
// the Suraksha Life (insurer) console displayed Bharat Union Bank's own system prompt. Those are public
// demo links handed to outsiders, so one tenant was reading another's AI configuration.
//
// This is the second leak of the same shape found on 2026-08-05; the first was the audit trail
// (see the AuditSearchParams.org comment in siem.ts). Both had the same cause — a tenant boundary that
// was optional, or absent, in a shared read path — so both are fixed the same way: the boundary becomes
// a REQUIRED parameter, and the decision about who owns a record is pure and directly testable, here.
//
// THE MARKERS ARE NOT UNIFORM, because the upstream store models each entity differently:
//   • traces   — carry `metadata.attributes.org`, stamped by our own emitter. Authoritative.
//   • prompts  — carry `tags[]`, so ownership is the tag `org:<orgId>`. The list endpoint filters on
//                tags natively (`?tag=`), so this is also the cheapest to push down.
//   • datasets — carry free-form `metadata`, so ownership is `metadata.org`.
//   • sessions — carry NOTHING. A session id is one of our own run ids, so ownership is resolved by
//                asking our own database which runs belong to the org, and passing that set in. Keeping
//                that lookup OUT of this module is what keeps this file pure and unit-testable.
//
// THE GOVERNING RULE, in all four cases: a record whose owner cannot be established belongs to NOBODY
// and is shown to NOBODY. There is deliberately no "unmarked means shared" fallback, because that
// fallback is precisely how one tenant sees another's data — it is the bug, wearing the costume of a
// sensible default. The same decision excluded 122 unattributable legacy documents from the audit fix.

/** The prefix that makes a Langfuse tag an ownership claim. */
export const ORG_TAG_PREFIX = 'org:';

/** The tag that marks a prompt as belonging to `orgId`. */
export function orgTag(orgId: string): string {
  return `${ORG_TAG_PREFIX}${orgId}`;
}

// A blank/whitespace org is not a tenant. Treating it as one would make every unmarked record match it,
// which is the fallback this module exists to refuse.
function usableOrg(orgId: string | null | undefined): string | null {
  if (typeof orgId !== 'string') return null;
  const trimmed = orgId.trim();
  return trimmed === '' ? null : trimmed;
}

// Read a string property from an unknown value without trusting its shape. `metadata` is free-form on
// both traces and datasets, so it can legitimately be null, a string, or an arbitrary object.
function stringProp(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/** The org a TRACE belongs to, from `metadata.attributes.org`; null when unattributed. */
export function traceOrg(trace: { metadata?: unknown }): string | null {
  const attributes = (() => {
    if (typeof trace.metadata !== 'object' || trace.metadata === null) return null;
    return (trace.metadata as Record<string, unknown>).attributes ?? null;
  })();
  return stringProp(attributes, 'org');
}

/** The org a DATASET belongs to, from `metadata.org`; null when unmarked. */
export function datasetOrg(dataset: { metadata?: unknown }): string | null {
  return stringProp(dataset.metadata, 'org');
}

/** The org a PROMPT belongs to, from its `org:` tag; null when untagged. */
export function promptOrg(prompt: { tags?: string[] | null }): string | null {
  const tags = prompt.tags ?? [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    if (!tag.startsWith(ORG_TAG_PREFIX)) continue;
    const owner = tag.slice(ORG_TAG_PREFIX.length).trim();
    if (owner !== '') return owner;
  }
  return null;
}

// Every filter below is the same shape: resolve the owner, keep it only on an exact match. Written once
// per entity rather than shared through a generic, because the OWNER RESOLUTION differs per entity and
// hiding that behind a generic is what makes this class of bug hard to see.

/** Traces belonging to `orgId`. Unattributed traces are returned to nobody. */
export function filterTracesForOrg<T extends { metadata?: unknown }>(
  traces: readonly T[],
  orgId: string | null | undefined,
): T[] {
  const org = usableOrg(orgId);
  if (org === null) return [];
  return traces.filter((t) => traceOrg(t) === org);
}

/** Prompts belonging to `orgId`. Untagged prompts are returned to nobody. */
export function filterPromptsForOrg<T extends { tags?: string[] | null }>(
  prompts: readonly T[],
  orgId: string | null | undefined,
): T[] {
  const org = usableOrg(orgId);
  if (org === null) return [];
  return prompts.filter((p) => promptOrg(p) === org);
}

/** Datasets belonging to `orgId`. Unmarked datasets are returned to nobody. */
export function filterDatasetsForOrg<T extends { metadata?: unknown }>(
  datasets: readonly T[],
  orgId: string | null | undefined,
): T[] {
  const org = usableOrg(orgId);
  if (org === null) return [];
  return datasets.filter((d) => datasetOrg(d) === org);
}

/**
 * Records whose owner has ALREADY been resolved into an `org` field — the shaped `DatasetRow`, which
 * carries `org` instead of the raw `metadata` it was derived from.
 *
 * Separate from filterDatasetsForOrg because the input is different: one resolves the owner from raw
 * upstream metadata, this one trusts an owner already resolved by the shaper. Both apply the same
 * rule — exact match, and a null owner matches nobody.
 */
export function filterByResolvedOrg<T extends { org: string | null }>(
  rows: readonly T[],
  orgId: string | null | undefined,
): T[] {
  const org = usableOrg(orgId);
  if (org === null) return [];
  return rows.filter((r) => r.org === org);
}

/**
 * Sessions belonging to `orgId`.
 *
 * A session carries no marker of its own — its id IS one of our run ids — so the caller resolves which
 * runs the org owns (from our own database, which does know) and passes the ids in. An empty set
 * therefore yields no sessions, which is correct: we could not establish ownership of any of them.
 */
export function filterSessionsForOrg<T extends { id?: string | null }>(
  sessions: readonly T[],
  ownedRunIds: ReadonlySet<string>,
): T[] {
  return sessions.filter((s) => typeof s.id === 'string' && ownedRunIds.has(s.id));
}

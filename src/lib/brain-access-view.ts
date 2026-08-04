// ─── Who may read, add to, or manage the organisation's memory? ────────────────────────────────────────
//
// The capability map on the brain's RBAC: "Authorization is enforced in the run path; a per-role
// brain-capability admin view is not yet surfaced."
//
// The gap became concrete the moment the memory-search page shipped: a viewer asked a question, got
// "You do not have permission to search the organisation's memory", and there was nowhere in the console
// to see WHO does have permission — or to check that the grant is as narrow as intended. Enforcement
// without visibility means the control exists and nobody can audit it.
//
// The policy lives in OFFGRID_ORGANIZATIONAL_BRAIN_ACCESS_POLICY (a deployment secret-adjacent env var),
// so this is a READ-ONLY projection. Editing access to organisational memory from a web form is not an
// improvement — it is a way to widen it by accident.
//
// Pure. Zero IO.

/** The three things the brain can be asked to do. */
export type BrainCapabilityName = 'retrieve' | 'ingest' | 'manageSources';

export interface BrainGrant {
  tenantId: string;
  /** Roles the grant applies to. Empty means the grant is not role-scoped. */
  roles: string[];
  /** Named subjects the grant applies to. Empty means not subject-scoped. */
  subjectIds: string[];
  documentSets: string[];
  capabilities: BrainCapabilityName[];
}

export interface CapabilityRow {
  capability: BrainCapabilityName;
  /** What this capability lets someone do, in plain words. */
  what: string;
  /** Who holds it — roles and named subjects, already merged and sorted. */
  holders: string[];
  /** True when nobody holds it at all. */
  nobody: boolean;
}

const CAPABILITY_COPY: Record<BrainCapabilityName, string> = {
  retrieve: 'Search the organisation’s memory and read what it returns',
  ingest: 'Add documents to the organisation’s memory',
  manageSources: 'Connect, sync, or remove the sources memory is built from',
};

const ORDER: readonly BrainCapabilityName[] = ['retrieve', 'ingest', 'manageSources'];

/**
 * Parse the deployment policy into grants for ONE tenant.
 *
 * Malformed entries are dropped rather than half-read: a grant we cannot parse must not appear as though
 * somebody holds it, and must not appear as though nobody does either — so `dropped` is reported and the
 * surface says the view is incomplete.
 */
export function parseBrainGrants(
  raw: unknown,
  tenantId: string,
): { grants: BrainGrant[]; dropped: number } {
  if (!Array.isArray(raw)) return { grants: [], dropped: 0 };
  const grants: BrainGrant[] = [];
  let dropped = 0;
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      dropped++;
      continue;
    }
    const o = e as Record<string, unknown>;
    const t = typeof o.tenantId === 'string' ? o.tenantId.trim() : '';
    if (!t) {
      dropped++;
      continue;
    }
    if (t !== tenantId) continue; // another tenant's grant — not ours to show
    const caps = (Array.isArray(o.capabilities) ? o.capabilities : []).filter(
      (c): c is BrainCapabilityName => typeof c === 'string' && (ORDER as readonly string[]).includes(c),
    );
    grants.push({
      tenantId: t,
      roles: (Array.isArray(o.roles) ? o.roles : []).filter((r): r is string => typeof r === 'string'),
      subjectIds: (Array.isArray(o.subjectIds) ? o.subjectIds : []).filter(
        (s): s is string => typeof s === 'string',
      ),
      documentSets: (Array.isArray(o.documentSetSlugs) ? o.documentSetSlugs : []).filter(
        (s): s is string => typeof s === 'string',
      ),
      capabilities: caps,
    });
  }
  return { grants, dropped };
}

/**
 * One row per capability, naming who holds it.
 *
 * EVERY capability is listed, including ones nobody holds — an absent row would read as "not applicable"
 * when the truth is "nobody can do this", and for `ingest` that is the difference between a memory that
 * can grow and one that is frozen.
 */
export function capabilityRows(grants: readonly BrainGrant[]): CapabilityRow[] {
  return ORDER.map((capability) => {
    const holders = new Set<string>();
    for (const g of grants) {
      if (!g.capabilities.includes(capability)) continue;
      for (const r of g.roles) holders.add(`${r} (role)`);
      for (const s of g.subjectIds) holders.add(s);
    }
    const list = [...holders].sort();
    return { capability, what: CAPABILITY_COPY[capability], holders: list, nobody: list.length === 0 };
  });
}

/**
 * One sentence for the surface.
 *
 * States the narrowness as a FACT rather than praising it: "only admin can search" is either exactly right
 * or a misconfiguration, and which one is the reader's call, not ours.
 */
export function describeBrainAccess(
  rows: readonly CapabilityRow[],
  grants: readonly BrainGrant[],
  dropped: number,
): string {
  if (grants.length === 0) {
    return dropped > 0
      ? `No usable access grants for this organisation — ${dropped} policy ${dropped === 1 ? 'entry was' : 'entries were'} unreadable, so nobody can use the organisation’s memory and the reason is a broken policy.`
      : 'No access grants exist for this organisation, so nobody can search or add to its memory.';
    }
  const readers = rows.find((r) => r.capability === 'retrieve');
  const incomplete = dropped > 0 ? ` ${dropped} policy ${dropped === 1 ? 'entry was' : 'entries were'} unreadable and are not shown.` : '';
  if (readers?.nobody) {
    return `Nobody is granted search access to the organisation’s memory, so the memory search surface will refuse every request.${incomplete}`;
  }
  return `Search access is held by ${readers?.holders.join(', ')}.${incomplete}`;
}

import { resolveRunBasis } from '@/lib/lawful-basis';
import { runSensitivity } from '@/lib/run-sensitivity';

// ─── The three governance questions, answered once for every execution path ─────────────────────────
//
// A run has to be able to say how sensitive the data it read was, which policy governed it, and on
// what lawful basis it was processed. App runs derived that inline; agent runs derived nothing.
// Duplicating the derivation would have guaranteed the two paths drifted, so it lives here and both
// call it — the DRY rule exists precisely for a decision two surfaces need.
//
// Everything here is best-effort by design: a governance stamp that can fail a run would make the
// run less reliable in exchange for a label, so a failure yields nulls and the surfaces report
// "not recorded" rather than guessing.

export interface GovernanceStamp {
  /** Highest classification the run read; null = nothing classified was read. */
  dataClassification: string | null;
  /** The policy version in force when it ran; null = no history recorded yet. */
  policyVersion: number | null;
  /** Why we were permitted; null = no personal-data source was read. */
  lawfulBasis: string | null;
}

export const NO_STAMP: GovernanceStamp = {
  dataClassification: null,
  policyVersion: null,
  lawfulBasis: null,
};

/**
 * Resolve the stamp from the data-domain ids a run actually bound.
 *
 * `boundDomains` may hold ids OR labels — app steps carry whichever the author picked, so both are
 * matched. An empty list is NOT an error: an ungrounded agent or a run with no connector step read no
 * declared source, and the honest answer is nulls, not zeroes.
 */
export async function resolveGovernanceStamp(
  boundDomains: readonly string[],
  orgId: string,
): Promise<GovernanceStamp> {
  try {
    const { currentPolicyVersion } = await import('@/lib/policy-versions-store');
    // The policy version applies to EVERY run, including one that read no declared data — the rules
    // still governed what it was allowed to do.
    const policyVersion = (await currentPolicyVersion(orgId).catch(() => 0)) || null;
    if (!boundDomains.length) return { ...NO_STAMP, policyVersion };

    const { listDomains } = await import('@/lib/data-domains-store');
    const domains = await listDomains(orgId);
    const read = domains.filter((d) => boundDomains.includes(d.id) || boundDomains.includes(d.label));
    if (!read.length) return { ...NO_STAMP, policyVersion };

    const dataClassification = runSensitivity(
      read.map((d) => ({
        label: d.label,
        classification: (d as { classification?: string | null }).classification ?? null,
      })),
    ).level;

    // The SUMMARY is stored, not a bare basis id: a run that read one grounded source and one
    // ungrounded one is not "consent", and a record saying so would overstate our position.
    const basis = resolveRunBasis(
      read.map((d) => ({
        id: d.id,
        label: d.label,
        lawfulBasis: (d as { lawfulBasis?: string | null }).lawfulBasis ?? null,
        purpose: (d as { purpose?: string | null }).purpose ?? null,
      })),
    );
    return { dataClassification, policyVersion, lawfulBasis: basis.summary };
  } catch {
    return NO_STAMP;
  }
}

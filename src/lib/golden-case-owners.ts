// ─── Which APP does this quality check belong to — PURE ────────────────────────────────────────────
//
// FOUNDER, live (2026-08-02): "quality needs to be more tightly coupled to apps, else what's the
// point. right now it seems standalone which makes no sense."
//
// He is right, and the screenshot shows exactly why: the golden-cases list rendered a raw suite chip —
// `pipeline:pl_seed_org_bharat_kyc-verification` — and nothing else. Nowhere on that page does it say
// which APP those checks govern, so a reader cannot answer the only question that matters about a
// quality check: what breaks if it fails.
//
// A case reaches an app two ways, and both must be shown:
//   • DIRECTLY — app_id is that app (a check derived from, or written for, that app)
//   • THROUGH ITS PIPELINE — the case is bound to a pipeline, and every app running on that pipeline
//     is measured by it. This is the one the UI was hiding, and it is the common case: the seeded
//     checks are all pipeline-bound.
//
// Pure: given the cases, the apps and the pipelines, decide the coupling. No I/O, so the rule is
// testable and the same wording appears wherever a case is listed.

export interface CaseLike {
  id: string;
  appId?: string | null;
  pipelineId?: string | null;
  suite?: string | null;
}

export interface AppLike {
  id: string;
  title: string;
  pipelineId?: string | null;
}

export interface CaseOwners {
  /** Apps this case actually measures — direct first, then via the shared pipeline. */
  apps: { id: string; title: string; via: 'app' | 'pipeline' }[];
  /** The pipeline's human name, when the case is pipeline-bound. */
  pipelineName: string | null;
  /**
   * True when nothing runs this case. An org-wide case is REUSABLE, not broken — but a reader must be
   * able to tell "reusable" from "measures three of your apps", which a suite chip cannot express.
   */
  unattached: boolean;
}

export function ownersForCase(
  c: CaseLike,
  apps: AppLike[],
  pipelineNames: Map<string, string>,
): CaseOwners {
  const out: CaseOwners['apps'] = [];
  const seen = new Set<string>();

  if (c.appId) {
    const direct = apps.find((a) => a.id === c.appId);
    if (direct) {
      out.push({ id: direct.id, title: direct.title, via: 'app' });
      seen.add(direct.id);
    }
  }
  if (c.pipelineId) {
    for (const a of apps) {
      if (a.pipelineId === c.pipelineId && !seen.has(a.id)) {
        out.push({ id: a.id, title: a.title, via: 'pipeline' });
        seen.add(a.id);
      }
    }
  }
  return {
    apps: out,
    pipelineName: c.pipelineId ? (pipelineNames.get(c.pipelineId) ?? c.pipelineId) : null,
    unattached: out.length === 0 && !c.pipelineId && !c.appId,
  };
}

/**
 * The sentence for a list row. Deliberately names the FIRST app and counts the rest rather than
 * printing five chips: the reader is scanning, and "KYC & Re-KYC Verification +2" answers "what breaks
 * if this fails" in one glance.
 */
export function describeOwners(owners: CaseOwners): string {
  if (owners.apps.length === 0) {
    return owners.pipelineName
      ? `${owners.pipelineName} — no app runs on it yet`
      : 'Reusable — not attached to an app or pipeline';
  }
  const [first, ...rest] = owners.apps;
  return rest.length ? `${first.title} +${rest.length}` : first.title;
}

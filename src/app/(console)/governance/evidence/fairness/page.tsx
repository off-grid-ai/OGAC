import { PageFrame } from '@/components/PageFrame';
import { FairnessEvidence, type FairnessAppRow } from '@/components/governance/FairnessEvidence';
import { listApps } from '@/lib/apps-store';
import { listFairnessRuns } from '@/lib/fairness-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Fairness, under EVIDENCE ──────────────────────────────────────────────────────────────────────
//
// WHATS_MISSING_2 #5: zero fairness or bias checks existed, on a tenant whose live apps underwrite personal
// loans and assess death claims. For a decision that DECLINES somebody, "does this app approve some groups
// less often?" is the question a regulator opens with — and it sits under Evidence because a filed, dated
// check is what they ask to see, not a screen that recomputes.
//
// Only apps that DECIDE about a person are listed. An app with no human decision and no approve/decline
// outcome has no selection rate to compare, and padding this page with those would make an untested estate
// look larger than it is.
export default async function FairnessEvidencePage() {
  await requireModuleForUser('audit');
  const orgId = await currentOrgId();
  const apps = await listApps(orgId).catch(() => []);

  const rows: FairnessAppRow[] = [];
  for (const app of apps) {
    const steps = (app.steps ?? []) as { kind?: string }[];
    // A decision about a person = a human approval step. That is the outcome fairness compares.
    const decides = steps.some((s) => s.kind === 'human');
    if (!decides) continue;
    const runs = await listFairnessRuns(app.id, orgId).catch(() => []);
    const latest = runs[0] ?? null;
    rows.push({
      appId: app.id,
      appTitle: app.title,
      decides,
      latest: latest
        ? {
            ranAt: latest.ranAt,
            ranBy: latest.ranBy,
            decided: latest.decided,
            tested: latest.tested,
            flagged: latest.flagged,
            sentence: latest.report.sentence,
            remedy: latest.report.remedy ?? null,
            absent: latest.report.absent ?? [],
            coverage: latest.report.coverage ?? [],
            findings: (latest.report.findings ?? []).map((f) => ({
              attribute: f.attribute,
              verdict: f.verdict,
              sentence: f.sentence,
            })),
          }
        : null,
    });
  }

  return (
    <PageFrame>
      <FairnessEvidence rows={rows} />
    </PageFrame>
  );
}

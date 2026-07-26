import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listOnlineScores, summarizeQuality } from '@/lib/qa/online-scores';
import { detectQualityRegression, regressedSubjects } from '@/lib/qa/quality-regression';
import { currentOrgId } from '@/lib/tenancy';

// GET /api/v1/admin/qa/regression — "are our answers getting worse?"
//
// Reads this tenant's RETAINED judge verdicts and compares each subject's newest runs against the
// baseline that preceded them. Data drift (the /qa/drift surface) watches the INPUTS; this watches
// the thing the enterprise actually feels — the answers.
//
// Thin handler: the whole judgement (windowing, minimum samples, unjudged exclusion, threshold)
// is the pure detectQualityRegression. This only reads, parameterises and shapes.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const num = (key: string, fallback: number): number => {
    const raw = Number(url.searchParams.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };

  const orgId = await currentOrgId();
  const scores = await listOnlineScores(orgId, num('limit', 500));
  const subjects = detectQualityRegression(scores, {
    recentSize: num('recent', 10),
    minSamples: num('minSamples', 5),
    dropThreshold: num('drop', 0.15),
  });

  return NextResponse.json({
    object: 'quality_regression',
    retained: scores.length,
    // Honest empty state: no judged verdicts means "nothing measured yet", NOT "everything is fine".
    measured: scores.some((s) => s.judged),
    regressed: regressedSubjects(subjects),
    subjects,
    trend: summarizeQuality(scores),
  });
}

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { readQualityRegression } from '@/lib/qa/quality-regression';
import { currentOrgId } from '@/lib/tenancy';

// GET /api/v1/admin/qa/regression — "are our answers getting worse?"
//
// Reads this tenant's RETAINED judge verdicts and compares each subject's newest runs against the
// baseline that preceded them. Data drift (the /solutions/quality/drift surface) watches the INPUTS;
// this watches the thing the enterprise actually feels — the answers.
//
// Thin handler: the judgement (windowing, minimum samples, unjudged exclusion, threshold) is the pure
// detectQualityRegression, reached through the shared readQualityRegression the drift page also uses.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const num = (key: string, fallback: number): number => {
    const raw = Number(url.searchParams.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };

  const view = await readQualityRegression(
    await currentOrgId(),
    { recentSize: num('recent', 10), minSamples: num('minSamples', 5), dropThreshold: num('drop', 0.15) },
    num('limit', 500),
  );

  return NextResponse.json({ object: 'quality_regression', ...view });
}

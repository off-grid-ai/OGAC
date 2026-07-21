import { NextResponse } from 'next/server';
import { EVALS_PORTS } from '@/lib/adapters/evals';
import { getEvals } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { recordEvalRun } from '@/lib/evals';
import { resolveRunEngine } from '@/lib/evals-golden';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Run an offline eval over the golden set and persist it so it appears in the pass-rate rollup.
// Body `{ engine }` picks the evaluator (golden | promptfoo | ragas); omitted → the env-selected
// default adapter. Each OSS adapter falls back to golden if its tool/sidecar is unavailable, so a
// run always records a scored result. golden persists in-process (runEval); promptfoo/ragas return
// their EvalRunResult, which we persist here with its engine so the per-engine rollup includes it.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  const requested = body?.engine as unknown;

  let port = getEvals();
  if (requested !== undefined && requested !== null && requested !== '') {
    const engine = resolveRunEngine(requested);
    if (!engine) {
      return NextResponse.json({ error: `unknown engine: ${String(requested)}` }, { status: 400 });
    }
    port = EVALS_PORTS.find((p) => p.meta.id === engine) ?? port;
  }

  const orgId = await currentOrgId();
  const result = await port.run(orgId);
  // golden's runEval already inserted the row (under orgId); non-golden adapters only return the
  // result, so persist those under the caller's org so its per-engine rollup includes them.
  if (result.engine !== 'golden') {
    await recordEvalRun(
      {
        id: result.id,
        engine: result.engine,
        score: result.score,
        total: result.total,
        passed: result.passed,
        // Persist the engine attribution (Ragas records version + judge routing + returned/omitted
        // metrics in detail) so the retained run proves HOW it was produced, not just its score.
        attribution: result.detail ?? null,
      },
      orgId,
    );
  }
  return NextResponse.json(result, { status: 201 });
}

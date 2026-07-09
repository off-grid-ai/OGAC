import { NextResponse } from 'next/server';
import { getEvalDef } from '@/lib/eval-defs';
import { runEvalDef } from '@/lib/eval-runner';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Run a saved eval definition against the golden set. Scores its metric with the definition's
// engine (real ragas when the sidecar is configured; first-party heuristic otherwise) and persists
// the run so it appears in the pass-rate rollup. Returns per-metric scores + which engine computed
// them (honest degradation — never a fabricated score).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  // Org-scoped: a tenant can only run its OWN eval def; another tenant's id resolves to null → 404.
  const def = await getEvalDef(id, orgId);
  if (!def) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const result = await runEvalDef(def, orgId);
  return NextResponse.json(result, { status: 201 });
}

import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { verifyRunProvenance } from '@/lib/provenance-ops';
import { currentOrgId } from '@/lib/tenancy';

// On-demand VERIFY for a single agent-run's signed provenance. Re-checks the stored signature
// against the active signing key and returns an HONEST verdict (verified / tampered / key-mismatch /
// unsigned). Admin-gated and audited. Supports bulk verify via `runIds[]`.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as { runId?: unknown; runIds?: unknown } | null;
  const ids: string[] = Array.isArray(body?.runIds)
    ? body!.runIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : typeof body?.runId === 'string' && body.runId.trim()
      ? [body.runId.trim()]
      : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: 'runId or runIds[] required' }, { status: 400 });
  }

  const org = await currentOrgId();
  const results = await Promise.all(ids.map((id) => verifyRunProvenance(id, org)));
  const found = results.filter((r): r is NonNullable<typeof r> => r != null);

  for (const r of found) {
    // Audit the verdict — the outcome reflects whether provenance held (ok) or failed (error).
    auditFromSession(gate, org, {
      action: 'provenance.verify',
      resource: `run:${r.runId}`,
      runId: r.runId,
      outcome: r.ok ? 'ok' : 'error',
    });
  }

  // A single-id request returns the single verdict; a bulk request returns the array + a rollup.
  if (ids.length === 1) {
    if (found.length === 0) return NextResponse.json({ error: 'unknown run' }, { status: 404 });
    return NextResponse.json(found[0]);
  }
  const verified = found.filter((r) => r.status === 'verified').length;
  return NextResponse.json({
    results: found,
    total: found.length,
    verified,
    failed: found.length - verified,
    unknown: ids.length - found.length,
  });
}

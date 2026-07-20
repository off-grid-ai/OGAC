import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  buildDriftRunConfig,
  type DriftMethodOverride,
} from '@/lib/drift-catalog';
import { readDriftView } from '@/lib/drift-view';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Admin drift read-back — the normalized drift display model (overall verdict + per-feature drift
// status/score + windows + last-checked). Best-effort: readDriftView never throws, so a
// { data, error } envelope is always returned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await readDriftView({ orgId: await currentOrgId() }));
}

// Run drift with a selection from the standard drift catalog. The body names a catalog item id
// (a preset or a method) + optional per-column overrides + drift-share threshold; we resolve it to
// the run config (pure, buildDriftRunConfig) and forward it to the SAME drift run path — no new
// engine. Honest degradation is handled downstream: without Evidently the built-in PSI heuristic
// runs and still honors the threshold.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => ({}))) as {
    itemId?: unknown;
    columnOverrides?: unknown;
    driftShareThreshold?: unknown;
  };
  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  const columnOverrides: DriftMethodOverride[] = Array.isArray(body.columnOverrides)
    ? body.columnOverrides
        .filter(
          (o): o is DriftMethodOverride =>
            !!o &&
            typeof o === 'object' &&
            typeof (o as DriftMethodOverride).column === 'string' &&
            typeof (o as DriftMethodOverride).methodId === 'string',
        )
        .map((o) => ({ column: o.column, methodId: o.methodId }))
    : [];

  const config = buildDriftRunConfig({
    itemId,
    columnOverrides,
    driftShareThreshold:
      typeof body.driftShareThreshold === 'number' ? body.driftShareThreshold : undefined,
  });

  const result = await readDriftView({
    orgId: await currentOrgId(),
    preset: config.preset,
    method: config.method,
    columnMethods: config.columnMethods,
    driftShareThreshold: config.driftShareThreshold,
  });
  return NextResponse.json({ ...result, config });
}

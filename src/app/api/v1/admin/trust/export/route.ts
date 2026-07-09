import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  buildPosture,
  COMPLIANCE_ARTIFACTS,
  INDIA_BFSI_FRAMINGS,
  rollupFramings,
  summarisePosture,
} from '@/lib/trust-center';
import { collectPostureInputs } from '@/lib/trust-center-inputs';
import { buildTrustReport } from '@/lib/trust-report';

export const dynamic = 'force-dynamic';

// One-click downloadable "trust summary" — the security & compliance evidence pack a buyer's
// procurement team asks for. Generated live from real deployment posture; honest about open items.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const inputs = await collectPostureInputs();
  const posture = buildPosture(inputs);
  const summary = summarisePosture(posture, new Date().toISOString());
  const framings = rollupFramings(INDIA_BFSI_FRAMINGS, posture);
  const { filename, body } = buildTrustReport({
    summary,
    posture,
    framings,
    artifacts: COMPLIANCE_ARTIFACTS,
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}

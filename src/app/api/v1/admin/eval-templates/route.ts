import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  EVAL_TEMPLATES,
  engineAvailability,
  isDegraded,
  type EngineEnv,
} from '@/lib/eval-templates';

export const dynamic = 'force-dynamic';

// Evaluator template catalog + honest per-engine availability. The env snapshot is read HERE
// (server-only) and handed to the pure availability logic so the catalog reports truthfully which
// metrics can be computed for real right now vs. which need a sidecar configured.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const env: EngineEnv = {
    ragasUrl: process.env.OFFGRID_RAGAS_URL,
    evidentlyUrl: process.env.OFFGRID_EVIDENTLY_URL,
    guardrailsUrl: process.env.OFFGRID_GUARDRAILS_URL,
    presidioUrl: process.env.OFFGRID_PRESIDIO_URL,
  };

  const templates = EVAL_TEMPLATES.map((t) => {
    const avail = engineAvailability(t.engine, env);
    return {
      ...t,
      availability: {
        available: avail.available,
        degraded: isDegraded(t.engine, env),
        detail: avail.detail,
      },
    };
  });

  return NextResponse.json({ object: 'list', data: templates });
}

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { suggestControls, type PipelineDraft } from '@/lib/suggest-controls';

export const dynamic = 'force-dynamic';

// Auto-suggest guardrails + evals for a draft pipeline (M5). Given the pipeline's plain-language
// purpose + data allowlist, return a starter set of guardrails + evals from the existing catalogs
// that the builder can one-click apply. Pure rules — deterministic, explainable, never fabricated.
interface Body {
  purpose?: string;
  allowlist?: unknown;
}

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as Body | null;
  const purpose = (body?.purpose ?? '').trim();
  const allowlist = Array.isArray(body?.allowlist)
    ? body!.allowlist.filter((x): x is string => typeof x === 'string')
    : [];
  if (!purpose) {
    return NextResponse.json({ error: 'purpose is required' }, { status: 400 });
  }

  const draft: PipelineDraft = { purpose, allowlist };
  return NextResponse.json(suggestControls(draft));
}

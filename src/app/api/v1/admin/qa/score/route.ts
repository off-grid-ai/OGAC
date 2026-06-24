import { NextResponse } from 'next/server';
import { getFlags } from '@/lib/adapters/registry';
import { type Interaction, scoreInteraction, scoringConfigured } from '@/lib/qa/scoring';

// Online eval — judge one production interaction (LLM-as-judge via the gateway) and push the
// quality + faithfulness scores to Langfuse, where they trend over time. Gated by the
// `online-evals` feature flag (checked through the flags port, so Unleash governs it when active).
export async function POST(req: Request) {
  const enabled = await getFlags().isEnabled('online-evals', true);
  if (!enabled) {
    return NextResponse.json({ error: 'online evals disabled (flag: online-evals)' }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as Partial<Interaction> | null;
  if (!b || typeof b.input !== 'string' || typeof b.output !== 'string') {
    return NextResponse.json({ error: 'input (string) + output (string) required' }, { status: 400 });
  }
  const result = await scoreInteraction({
    input: b.input,
    output: b.output,
    sources: Array.isArray(b.sources) ? b.sources.filter((s) => typeof s === 'string') : undefined,
    traceId: typeof b.traceId === 'string' ? b.traceId : undefined,
    name: typeof b.name === 'string' ? b.name : undefined,
  });
  return NextResponse.json({ ...result, langfuse: scoringConfigured() }, { status: 201 });
}

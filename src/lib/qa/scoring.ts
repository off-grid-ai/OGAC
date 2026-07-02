import { randomUUID } from 'crypto';

// Online evals — score real production interactions on the LLM-as-judge pattern and push the
// scores to Langfuse, where they trend over time (a falling score IS the degradation signal).
// The judge runs through OUR gateway (no external model); scores are written via Langfuse's
// ingestion API as a trace + numeric scores. Best-effort: a Langfuse outage never throws to the
// caller, it just returns posted:false.
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
const JUDGE_MODEL = process.env.OFFGRID_EVAL_MODEL ?? 'gemma-local';
const LANGFUSE_URL = process.env.OFFGRID_LANGFUSE_URL;
const LANGFUSE_AUTH = process.env.OFFGRID_LANGFUSE_AUTH; // base64("public-key:secret-key")

export interface Interaction {
  input: string;
  output: string;
  sources?: string[];
  traceId?: string; // attach scores to an existing trace if known; otherwise one is created
  name?: string;
}

export interface JudgeVerdict {
  quality: number; // 0..1 — is the answer helpful, correct, on-task
  faithfulness: number; // 0..1 — is it grounded in the provided sources
  reasoning: string;
}

export interface ScoreResult {
  traceId: string;
  verdict: JudgeVerdict;
  judged: boolean; // did the gateway judge return a verdict (false if the gateway was unreachable)
  posted: boolean; // did Langfuse accept the scores
}

function judgePrompt(i: Interaction): string {
  const src = i.sources?.length
    ? `\n\nSOURCES:\n${i.sources.map((s, n) => `[${n + 1}] ${s}`).join('\n')}`
    : '\n\n(no sources provided — score faithfulness as 1 if no external claims are made)';
  return (
    `USER INPUT:\n${i.input}\n\nAGENT OUTPUT:\n${i.output}${src}\n\n` +
    'Rate the agent output. Return JSON {"quality":0..1,"faithfulness":0..1,"reasoning":"..."}. ' +
    'quality = correct, helpful, on-task. faithfulness = supported by the SOURCES (no fabrication). ' +
    'Be strict and concise.'
  );
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

async function judge(i: Interaction): Promise<JudgeVerdict> {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: gatewayHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: JUDGE_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a strict evaluator of AI agent outputs.' },
        { role: 'user', content: judgePrompt(i) },
      ],
      response_format: { type: 'json_object' },
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(90_000), // local reasoning models can be slow, esp. cold
  });
  if (!res.ok) throw new Error('gateway judge unavailable');
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
  return {
    quality: clamp01(parsed.quality),
    faithfulness: clamp01(parsed.faithfulness),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}

interface IngestionEvent {
  id: string;
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
}

function scoreEvent(traceId: string, name: string, value: number, comment: string): IngestionEvent {
  return {
    id: randomUUID(),
    type: 'score-create',
    timestamp: new Date().toISOString(),
    body: { id: randomUUID(), traceId, name, value, dataType: 'NUMERIC', comment },
  };
}

// Push a trace (if we created the id) + the numeric scores to Langfuse via the ingestion API.
async function postToLangfuse(i: Interaction, traceId: string, v: JudgeVerdict): Promise<boolean> {
  if (!LANGFUSE_URL || !LANGFUSE_AUTH) return false;
  const ts = new Date().toISOString();
  const batch: IngestionEvent[] = [];
  if (!i.traceId) {
    batch.push({
      id: randomUUID(),
      type: 'trace-create',
      timestamp: ts,
      body: { id: traceId, name: i.name ?? 'agent-qa', input: i.input, output: i.output },
    });
  }
  batch.push(scoreEvent(traceId, 'quality', v.quality, v.reasoning));
  batch.push(scoreEvent(traceId, 'faithfulness', v.faithfulness, v.reasoning));
  try {
    const res = await fetch(`${LANGFUSE_URL}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${LANGFUSE_AUTH}` },
      body: JSON.stringify({ batch }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Judge one interaction and record its scores in Langfuse. Degrades gracefully: if the gateway
// judge is unreachable it returns judged:false (and skips the Langfuse write so a fabricated 0
// score never pollutes the trace); if Langfuse is down it returns posted:false.
export async function scoreInteraction(i: Interaction): Promise<ScoreResult> {
  const traceId = i.traceId ?? randomUUID().replace(/-/g, '');
  let verdict: JudgeVerdict;
  try {
    verdict = await judge(i);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'judge unavailable';
    return { traceId, verdict: { quality: 0, faithfulness: 0, reasoning: reason }, judged: false, posted: false };
  }
  const posted = await postToLangfuse(i, traceId, verdict);
  return { traceId, verdict, judged: true, posted };
}

export function scoringConfigured(): boolean {
  return Boolean(LANGFUSE_URL && LANGFUSE_AUTH);
}

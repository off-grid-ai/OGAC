import type { ClaimVerdict, GroundingPort, GroundingResult, GroundingSource } from './types';

// Grounding / attribution adapters. Standalone capability: verify a generated answer against
// its cited sources, independent of any retrieval store or the Brain. The model-backed adapter
// runs entirely through OUR gateway (the one gateway) — no separate model dependency. If the
// gateway is unreachable it degrades to the lexical adapter so verification still returns.
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
const GROUNDING_MODEL = process.env.OFFGRID_GROUNDING_MODEL ?? 'gemma-local';
const MAX_CLAIMS = 12;

function splitClaims(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

// Lexical overlap: fraction of a claim's tokens present in the best-matching source.
function lexicalVerdict(claim: string, sources: GroundingSource[]): ClaimVerdict {
  const claimTokens = [...tokens(claim)];
  let best = { ratio: 0, source: undefined as string | undefined };
  for (const s of sources) {
    const src = tokens(s.text);
    const hits = claimTokens.filter((t) => src.has(t)).length;
    const ratio = claimTokens.length ? hits / claimTokens.length : 0;
    if (ratio > best.ratio) best = { ratio, source: s.id ?? s.text.slice(0, 40) };
  }
  const score = Number(best.ratio.toFixed(2));
  return { claim, supported: score >= 0.6, score, source: best.source };
}

function aggregate(verdicts: ClaimVerdict[], truncated: number): GroundingResult {
  const supported = verdicts.filter((v) => v.supported).length;
  const score = verdicts.length ? Math.round((supported / verdicts.length) * 100) : 0;
  return { score, verdicts, truncated: truncated || undefined };
}

export const heuristicGrounding: GroundingPort = {
  meta: {
    id: 'lexical',
    capability: 'grounding',
    vendor: 'Off Grid lexical',
    license: 'first-party',
    render: 'native',
    description: 'Token-overlap grounding. Offline, no model — the deterministic baseline.',
  },
  verify(answer, sources) {
    const claims = splitClaims(answer);
    const truncated = Math.max(0, claims.length - MAX_CLAIMS);
    const verdicts = claims.slice(0, MAX_CLAIMS).map((c) => lexicalVerdict(c, sources));
    return Promise.resolve(aggregate(verdicts, truncated));
  },
  health: () => Promise.resolve(true),
};

interface GwVerdict {
  index: number;
  supported: boolean;
  score: number;
  source?: string;
}

function buildPrompt(claims: string[], sources: GroundingSource[]): string {
  const src = sources.map((s, i) => `[S${i + 1}${s.id ? ` ${s.id}` : ''}] ${s.text}`).join('\n');
  const cl = claims.map((c, i) => `${i}. ${c}`).join('\n');
  return (
    `SOURCES:\n${src}\n\nCLAIMS:\n${cl}\n\n` +
    'For each claim, decide if it is entailed by the SOURCES. Return JSON ' +
    '{"verdicts":[{"index":int,"supported":bool,"score":0..1,"source":"S#"}]}. ' +
    'Be strict: if the sources do not support a claim, supported=false.'
  );
}

function extractVerdicts(data: unknown): GwVerdict[] {
  const content = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]
    ?.message?.content;
  const parsed = JSON.parse(content ?? '{}');
  if (!Array.isArray(parsed?.verdicts)) throw new Error('unexpected grounding shape');
  return parsed.verdicts as GwVerdict[];
}

async function gatewayVerify(claims: string[], sources: GroundingSource[]): Promise<GwVerdict[]> {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: gatewayHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: GROUNDING_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a strict entailment checker.' },
        { role: 'user', content: buildPrompt(claims, sources) },
      ],
      response_format: { type: 'json_object' },
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('gateway grounding unavailable');
  return extractVerdicts(await res.json());
}

export const modelGrounding: GroundingPort = {
  meta: {
    id: 'gateway-nli',
    capability: 'grounding',
    vendor: 'Off Grid AI Gateway (NLI)',
    license: 'first-party',
    render: 'native',
    description: 'Entailment-based grounding via the gateway model. Falls back to lexical offline.',
  },
  async verify(answer, sources) {
    const claims = splitClaims(answer);
    const truncated = Math.max(0, claims.length - MAX_CLAIMS);
    const use = claims.slice(0, MAX_CLAIMS);
    try {
      const gw = await gatewayVerify(use, sources);
      const verdicts: ClaimVerdict[] = use.map((claim, i) => {
        const v = gw.find((x) => x.index === i);
        return {
          claim,
          supported: Boolean(v?.supported),
          score: Number((v?.score ?? 0).toFixed(2)),
          source: v?.source,
        };
      });
      return aggregate(verdicts, truncated);
    } catch {
      return heuristicGrounding.verify(answer, sources);
    }
  },
  async health() {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/models`, { headers: gatewayHeaders(), signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

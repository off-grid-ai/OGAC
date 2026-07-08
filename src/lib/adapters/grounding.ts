import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import {
  type EntailmentModel,
  MAX_CLAIMS,
  extractCompletionText,
  splitClaims,
  verifyWithModel,
} from './grounding-model';
import type { ClaimVerdict, GroundingPort, GroundingResult, GroundingSource } from './types';

// Grounding / attribution adapters. Standalone capability: verify a generated answer against
// its cited sources, independent of any retrieval store or the Brain.
//
// Two adapters behind one GroundingPort:
//   - heuristicGrounding ('lexical')  — token-overlap, offline, deterministic. The ALWAYS-ON FLOOR.
//   - modelGrounding ('model')        — model-NLI / entailment-grade, via OUR one gateway. Selected
//                                        by OFFGRID_ADAPTER_GROUNDING=model. Falls back to the
//                                        lexical floor if the gateway is unreachable.
//
// G-F3 (the paraphrase gap): the lexical floor scores by token overlap, so a PARAPHRASE of a
// source scores 0/unsupported even though it is entailed. The model adapter judges semantic
// entailment, so an entailed paraphrase scores supported. The lexical adapter stays the default
// (additive — nothing changes when OFFGRID_ADAPTER_GROUNDING is unset).

const GROUNDING_MODEL = process.env.OFFGRID_GROUNDING_MODEL ?? 'gemma-local';

// ─── Lexical (first-party, offline) floor ──────────────────────────────────────

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
    vendor: 'Off Grid AI lexical',
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

// ─── Model-NLI (entailment-grade) adapter ───────────────────────────────────────

/**
 * The real gateway entailment model. This is the ONLY I/O in the model adapter — everything else
 * (prompt build, parse, score) lives in the pure `grounding-model.ts` and is injected this fn.
 * Sends the constrained NLI prompt to our one gateway at temperature 0 and returns the raw text.
 * Throws on a non-OK gateway response so `verify` can fall back to the lexical floor.
 */
export const gatewayEntailmentModel: EntailmentModel = async (prompt) => {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: gatewayHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: GROUNDING_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a strict natural-language-inference (entailment) checker. Respond with JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`gateway grounding unavailable (${res.status})`);
  return extractCompletionText(await res.json());
};

/**
 * Build the model-NLI grounding adapter. The entailment model fn is INJECTED, so the adapter is
 * unit-testable with a fake model (no network). The exported `modelGrounding` binds the real
 * gateway model; tests can build their own with a stub. On any model failure it degrades to the
 * lexical floor — verification always returns an honest result, never throws at the call site.
 */
export function makeModelGrounding(model: EntailmentModel): GroundingPort {
  return {
    meta: {
      id: 'model',
      capability: 'grounding',
      vendor: 'Off Grid AI Gateway (NLI)',
      license: 'first-party',
      render: 'native',
      description:
        'Entailment-grade grounding via the gateway model — supports paraphrased sources, not just token overlap. Falls back to the lexical floor if the gateway is unreachable.',
    },
    async verify(answer, sources) {
      try {
        return await verifyWithModel(answer, sources, model);
      } catch {
        // Honest floor: model unreachable / malformed → lexical verdict, never a fabricated pass.
        return heuristicGrounding.verify(answer, sources);
      }
    },
    async health() {
      try {
        const res = await fetch(`${GATEWAY_URL}/v1/models`, {
          headers: gatewayHeaders(),
          signal: AbortSignal.timeout(2000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

export const modelGrounding: GroundingPort = makeModelGrounding(gatewayEntailmentModel);

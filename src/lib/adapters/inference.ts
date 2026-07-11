import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import { EMBED_DIM, type InferencePort } from './types';

// Inference adapters. The default is the Off Grid AI Gateway (OpenAI-compatible, on-device);
// if it is unreachable embeddings fall back to a deterministic local hash so the Brain still
// works offline. Any OpenAI-compatible endpoint can be bound here without touching callers.
const EMBED_MODEL = process.env.OFFGRID_EMBED_MODEL ?? 'all-MiniLM-L6-v2';

function deterministicEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const token of text.toLowerCase().split(/\W+/)) {
    if (!token) continue;
    let h = 0;
    for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
    v[Math.abs(h) % EMBED_DIM] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

async function gatewayEmbed(text: string): Promise<number[]> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/embeddings`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ input: text, model: EMBED_MODEL }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error('gateway embeddings unavailable');
    const data = await res.json();
    const vector = data?.data?.[0]?.embedding;
    if (Array.isArray(vector) && vector.length === EMBED_DIM) return vector;
    throw new Error('unexpected embedding shape');
  } catch {
    return deterministicEmbed(text);
  }
}

export const gatewayInference: InferencePort = {
  meta: {
    id: 'gateway',
    capability: 'inference',
    vendor: 'Off Grid AI Gateway',
    license: 'first-party',
    render: 'native',
    description: `OpenAI-compatible, MCP-native inference on-device at ${GATEWAY_URL}.`,
  },
  embed: gatewayEmbed,
  async health() {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/models`, { headers: gatewayHeaders(), signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

// A backend-free adapter for air-gapped/offline tests — never touches the network.
export const localInference: InferencePort = {
  meta: {
    id: 'local',
    capability: 'inference',
    vendor: 'Deterministic (offline)',
    license: 'first-party',
    render: 'headless',
    description: 'Deterministic local embeddings; no network. For air-gapped or test use.',
  },
  embed: (text) => Promise.resolve(deterministicEmbed(text)),
  health: () => Promise.resolve(true),
};

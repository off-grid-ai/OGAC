import { randomUUID } from 'node:crypto';
import { putObject, publicUrlFor } from '@/lib/files';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

// Console image generation — mirrors the desktop flow. The gateway aggregator proxies
// `POST /v1/images/generations` to sd-server (stable-diffusion.cpp, OpenAI-compatible) on an image
// node. We normalize the request (pure, below), call the gateway, then store the result in
// SeaweedFS (the single file-storage layer) under `generated/` and return its public URL — so
// generated images live in the same store as everything else and are viewable in Storage.

const SIZES = [512, 640, 768, 896, 1024] as const;

export interface ImageRequestInput {
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
}

export interface ImageRequest {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number; // -1 = random
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  value?: ImageRequest;
}

function clampToSize(n: number | undefined, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  // snap to the nearest allowed size so sd-server gets a sane, supported dimension
  return SIZES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), fallback);
}

// PURE: validate + normalize an untrusted image request. Zero I/O, unit-testable.
export function normalizeImageRequest(input: ImageRequestInput | null | undefined): ValidationResult {
  if (!input) return { ok: false, error: 'missing body' };
  const prompt = (input.prompt ?? '').trim();
  if (!prompt) return { ok: false, error: 'A prompt is required.' };
  if (prompt.length > 2000) return { ok: false, error: 'Prompt too long (max 2000 chars).' };
  const steps = Math.min(50, Math.max(1, Math.round(input.steps ?? 20)));
  const seed =
    typeof input.seed === 'number' && Number.isFinite(input.seed) ? Math.trunc(input.seed) : -1;
  return {
    ok: true,
    value: {
      prompt,
      negativePrompt: (input.negativePrompt ?? '').trim().slice(0, 2000),
      width: clampToSize(input.width, 768),
      height: clampToSize(input.height, 768),
      steps,
      seed,
    },
  };
}

export interface GeneratedImage {
  url: string;
  key: string;
  prompt: string;
  seed: number;
}

// Call the gateway, decode the returned image, store it in SeaweedFS, return its public URL.
export async function generateAndStore(req: ImageRequest): Promise<GeneratedImage> {
  const res = await fetch(`${GATEWAY_URL}/v1/images/generations`, {
    method: 'POST',
    headers: gatewayHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      prompt: req.prompt,
      negative_prompt: req.negativePrompt || undefined,
      width: req.width,
      height: req.height,
      steps: req.steps,
      seed: req.seed,
      n: 1,
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(Number(process.env.OFFGRID_IMAGE_TIMEOUT_MS || 300000)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`gateway image ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const data = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const item = data.data?.[0];
  if (!item?.b64_json && !item?.url) throw new Error('gateway returned no image');

  const key = `generated/${randomUUID()}.png`;
  if (item.b64_json) {
    await putObject(key, Buffer.from(item.b64_json, 'base64'), 'image/png');
  } else {
    // url form — fetch the bytes and re-store so the image lives in our store, not the node's
    const img = await fetch(item.url!, { signal: AbortSignal.timeout(30000) });
    await putObject(key, Buffer.from(await img.arrayBuffer()), 'image/png');
  }
  return { url: publicUrlFor(key), key, prompt: req.prompt, seed: req.seed };
}

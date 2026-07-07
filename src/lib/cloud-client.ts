// Thin OpenAI-compatible cloud ADAPTER. The ONLY module in the cloud layer that does network I/O.
// It shapes an OpenAI-compatible chat request for a selected provider and forwards it, streaming the
// response back unchanged. It performs NO governance — callers (the request path) MUST have cleared
// the pure `planCloudRoute` gate first. Keeping I/O isolated here (SOLID) means the decision + shaping
// logic stays pure and exhaustively testable; this adapter is the swappable seam.
//
// Request shape parity: providers are OpenAI-compatible, so we forward the SAME body the local
// gateway gets, only rewriting `model` to the provider's upstream id and adding the provider's bearer
// auth. `cloudEnv()` reads the process env once, so route handlers pass no secrets around.

import type { CloudProviderConfig, CloudSelection, CloudEnv } from './cloud-providers';
import { parseCloudProviders } from './cloud-providers';

/** Read the cloud-provider env from process.env (the ONE place we touch it). */
export function cloudEnv(): CloudEnv {
  return process.env as CloudEnv;
}

/** Parse the configured providers straight from process.env. Convenience for route handlers. */
export function configuredCloudProviders(): CloudProviderConfig[] {
  return parseCloudProviders(cloudEnv());
}

/**
 * Shape the outbound OpenAI-compatible request body for a cloud provider. PURE (no I/O): takes the
 * body the local gateway would have received and rewrites `model` to the provider's upstream id,
 * dropping any local-only knobs the cloud won't understand (llama.cpp's `chat_template_kwargs`).
 * Exported so it is unit-testable independently of the network.
 */
export function shapeCloudRequest(
  body: Record<string, unknown>,
  selection: CloudSelection,
): Record<string, unknown> {
  const { chat_template_kwargs, ...rest } = body;
  void chat_template_kwargs; // local-only (enable_thinking); cloud providers reject unknown keys
  return { ...rest, model: selection.model };
}

/** Build the auth + content headers for a provider call. PURE. */
export function cloudHeaders(provider: CloudProviderConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${provider.apiKey}`,
  };
}

export interface CloudCallResult {
  ok: boolean;
  status: number;
  /** The upstream response (streaming body preserved) when ok; null on transport failure. */
  response: Response | null;
  error?: string;
}

/**
 * Forward an OpenAI-compatible chat request to the selected cloud provider. Streams by preserving the
 * upstream Response body — the caller relays it. On any transport failure returns ok:false so the
 * caller can degrade honestly (surface an error / fall back), NEVER fabricate a response.
 *
 * The caller is responsible for governance (planCloudRoute) and for attributing cost + logging egress
 * to audit AFTER the response is consumed — this adapter only moves bytes.
 */
export async function forwardToCloud(
  selection: CloudSelection,
  body: Record<string, unknown>,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CloudCallResult> {
  const { provider } = selection;
  const url = `${provider.baseUrl}/chat/completions`;
  const shaped = shapeCloudRequest(body, selection);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: cloudHeaders(provider),
      body: JSON.stringify(shaped),
      signal: opts.signal ?? (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined),
    });
    return { ok: res.ok, status: res.status, response: res };
  } catch (e) {
    return { ok: false, status: 0, response: null, error: (e as Error).message };
  }
}

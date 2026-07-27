// Langfuse public-API HTTP transport — the ONE impure seam the write-capable prompt/dataset adapters
// authenticate through. The read-only trace/registry read-back in `langfuse.ts` keeps its own private
// GET helper; this is a NEW, self-contained transport for the MANAGEMENT surfaces (create/update/
// delete) so those adapters don't reach into `langfuse.ts` internals.
//
// Auth + base URL follow the SAME convention as `langfuse.ts` (documented there): base is
// OFFGRID_LANGFUSE_URL; the Basic header prefers the service-token broker's `basic` project keypair
// Auth resolution (vaulted keypair first, env fallback) is the ONE shared rule in langfuse-auth.ts.
import { langfuseAuthHeader, langfuseEnvAuthConfigured } from '@/lib/langfuse-auth';


function base(): string | undefined {
  return process.env.OFFGRID_LANGFUSE_URL;
}

// The legacy env-derived Basic header: explicit pk/sk, else the base64 OTLP auth blob. Same shape as

/** Broker-preferring Basic header — the ONE shared rule (langfuse-auth.ts). */
async function authHeader(): Promise<string | null> {
  return langfuseAuthHeader();
}

/**
 * Sync "is Langfuse write-back configured on this deployment?" — env-derived (matches
 * langfuseReadConfigured's contract). The broker keypair is async + returns `none` until provisioned,
 * so this reflects env only and never flips the gate before provisioning.
 */
export function langfuseConfigured(): boolean {
  return Boolean(base()) && langfuseEnvAuthConfigured();
}

export class LangfuseHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LangfuseHttpError';
  }
}

export interface LangfuseRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

/**
 * Perform ONE authenticated Langfuse public-API request. Throws LangfuseHttpError (with the HTTP
 * status) on a non-2xx or when unconfigured, and surfaces the transport cause code (ECONNREFUSED/…)
 * so an unreachable backend isn't an opaque "fetch failed". Returns the parsed JSON (or null on 204/
 * empty body).
 */
export async function langfuseRequest<T>(req: LangfuseRequest): Promise<T> {
  const auth = await authHeader();
  const b = base();
  if (!b || !auth) throw new LangfuseHttpError('Langfuse is not configured on this deployment', 503);
  const headers: Record<string, string> = { authorization: auth, accept: 'application/json' };
  const init: RequestInit = { method: req.method, headers, signal: AbortSignal.timeout(8000), cache: 'no-store' };
  if (req.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(req.body);
  }
  let res: Response;
  try {
    res = await fetch(`${b}${req.path}`, init);
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    throw new LangfuseHttpError(
      `${err.message}${err.cause?.code ? ` [${err.cause.code}]` : ''}`,
      502,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LangfuseHttpError(`Langfuse ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`, res.status);
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

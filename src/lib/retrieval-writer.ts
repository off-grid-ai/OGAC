// Retrieval / vector-store WRITER (Qdrant collection management). Thin best-effort I/O layer
// mirroring retrieval-view.ts's reader: it resolves the active adapter + URL, delegates all
// validation and payload/response shaping to the PURE helpers in retrieval-view.ts, and pushes
// through Qdrant's HTTP API (PUT/DELETE /collections/{name}). It never throws — every failure
// comes back as { ok:false, error } so route handlers can turn it into a clean 4xx/5xx with a
// message and never a bare 500.

import {
  activeRetrievalAdapter,
  buildCreatePayload,
  normalizeCollectionName,
  normalizeWriteResponse,
  type CreateCollectionInput,
} from '@/lib/retrieval-view';

export interface WriteOutcome {
  ok: boolean;
  error: string | null;
  /** HTTP status to surface from the route (400 validation, 502 upstream, 200 ok). */
  httpStatus: number;
  name?: string;
}

interface Target {
  url: string | null;
  error: string | null;
}

/** Resolve the Qdrant base URL, or an explanatory error when management isn't available. */
function resolveTarget(env: NodeJS.ProcessEnv): Target {
  const adapterId = activeRetrievalAdapter(env.OFFGRID_ADAPTER_RETRIEVAL);
  if (adapterId !== 'qdrant') {
    return { url: null, error: `active retrieval adapter is '${adapterId}', not qdrant — collection management unavailable` };
  }
  const url = (env.OFFGRID_QDRANT_URL ?? '').replace(/\/+$/, '') || null;
  if (!url) return { url: null, error: 'OFFGRID_QDRANT_URL is not set' };
  return { url, error: null };
}

async function send(url: string, init: RequestInit, timeoutMs = 5000): Promise<WriteOutcome> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => null);
    const { ok, error } = normalizeWriteResponse(res.status, body);
    return { ok, error, httpStatus: ok ? 200 : 502 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unreachable', httpStatus: 502 };
  }
}

/** Create a Qdrant collection via `PUT /collections/{name}`. Validation errors → httpStatus 400. */
export async function createCollection(
  input: CreateCollectionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WriteOutcome> {
  const built = buildCreatePayload(input);
  if (!built.payload || !built.name) {
    return { ok: false, error: built.error ?? 'invalid input', httpStatus: 400 };
  }
  const target = resolveTarget(env);
  if (!target.url) return { ok: false, error: target.error, httpStatus: 400 };

  const out = await send(`${target.url}/collections/${encodeURIComponent(built.name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(built.payload),
  });
  return { ...out, name: built.name };
}

/** Delete a Qdrant collection via `DELETE /collections/{name}`. Bad name → httpStatus 400. */
export async function deleteCollection(
  rawName: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WriteOutcome> {
  const name = normalizeCollectionName(rawName);
  if (!name) return { ok: false, error: 'invalid collection name', httpStatus: 400 };

  const target = resolveTarget(env);
  if (!target.url) return { ok: false, error: target.error, httpStatus: 400 };

  const out = await send(`${target.url}/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
  return { ...out, name };
}

/**
 * Recreate (clear) a collection: delete then create with the same params. Best-effort — a failed
 * delete of a non-existent collection is tolerated; a failed create surfaces its error.
 */
export async function recreateCollection(
  input: CreateCollectionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WriteOutcome> {
  const built = buildCreatePayload(input);
  if (!built.payload || !built.name) {
    return { ok: false, error: built.error ?? 'invalid input', httpStatus: 400 };
  }
  await deleteCollection(built.name, env); // tolerate missing
  return createCollection(input, env);
}

// ─── LiteLLM STRUCTURED-CALLBACKS adapter (I/O) — talks to the proxy's callbacks/team-logging API ──
//
// Reads the live active callbacks and performs the ONE runtime-supported callback write (team-scoped)
// against the DB-backed LiteLLM proxy. All decision logic (classification, validation, payload
// shaping) lives in the PURE litellm-callbacks.ts; this file only does fetch + endpoint-availability
// handling. Base-URL/master-key resolution + the Bearer GET are reused from litellm-http.ts (DRY);
// litellm-http has no POST helper, so the writes build their request here off the SAME resolver +
// env master key (no separate config path) — mirroring the response-cache adapter.
//
//   GET  /callbacks/list        — active success/failure/success_and_failure sinks (may 404 → fallback)
//   GET  /active/callbacks      — free-form active-callbacks dict (fallback read)
//   POST /team/{id}/callback    — add a callback sink for a team (runtime-settable, team-scoped)
//   POST /team/{id}/disable_logging — disable a team's callback logging
//
// Every read NEVER throws into a page — unconfigured ⇒ configured:false; unreachable/404 ⇒ honest
// error state. Writes return {ok:false,error} rather than throwing so the route returns a clean 502.
import {
  type CallbacksStatus,
  callbacksUnconfigured,
  callbacksUnreachable,
  interpretCallbacks,
  type RawCallbacksByType,
  type TeamCallbackPlan,
} from '@/lib/litellm-callbacks';
import {
  LiteLLMHttpError,
  type Fetcher,
  litellmBaseUrl,
  litellmGet,
  litellmHttpConfigured,
} from '@/lib/litellm-http';

// ─── callbacks status (READ) ─────────────────────────────────────────────────────────────────────

/**
 * The live callbacks status — NEVER throws. Unconfigured ⇒ configured:false. Reads /callbacks/list
 * (the structured CallbacksByType); if that 404s on the deployed version, falls back to
 * /active/callbacks. Any other failure ⇒ configured:true, reachable:false + honest error.
 */
export async function getCallbacksStatus(fetcher: Fetcher = fetch): Promise<CallbacksStatus> {
  if (!litellmHttpConfigured()) return callbacksUnconfigured();
  try {
    const raw = (await litellmGet('/callbacks/list', fetcher, 5000)) as RawCallbacksByType;
    return interpretCallbacks(raw);
  } catch (e) {
    if (e instanceof LiteLLMHttpError && e.status === 404) {
      // Older version without /callbacks/list — try the free-form active-callbacks dict.
      try {
        const raw = (await litellmGet('/active/callbacks', fetcher, 5000)) as RawCallbacksByType;
        return interpretCallbacks(raw);
      } catch (e2) {
        return callbacksUnreachable(
          e2 instanceof LiteLLMHttpError && e2.status === 404
            ? 'callbacks API not on this LiteLLM version (404)'
            : (e2 as Error).message,
        );
      }
    }
    return callbacksUnreachable((e as Error).message);
  }
}

// ─── team-callback writes (POST) ─────────────────────────────────────────────────────────────────

/** Authenticated POST against the proxy — reuses the same base URL + master key as litellm-http. */
async function litellmPost(path: string, body: unknown, fetcher: Fetcher, timeoutMs = 8000): Promise<unknown> {
  const base = litellmBaseUrl();
  if (!base) throw new LiteLLMHttpError(0, 'LiteLLM not configured (OFFGRID_LITELLM_URL unset)');
  const key = process.env.OFFGRID_LITELLM_MASTER_KEY;
  const res = await fetcher(`${base}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new LiteLLMHttpError(
      res.status,
      `LiteLLM ${path} ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  return res.json().catch(() => ({}));
}

export interface CallbackWriteResult {
  ok: boolean;
  error?: string;
}

/**
 * Attach a callback sink to a team (POST /team/{id}/callback). Returns ok:false + error on any proxy
 * failure (unconfigured / unreachable / 404) rather than throwing, so the route returns a clean 502.
 */
export async function setTeamCallback(
  plan: Extract<TeamCallbackPlan, { ok: true }>,
  fetcher: Fetcher = fetch,
): Promise<CallbackWriteResult> {
  if (!litellmHttpConfigured()) {
    return { ok: false, error: 'LiteLLM not configured (OFFGRID_LITELLM_URL unset)' };
  }
  try {
    await litellmPost(`/team/${encodeURIComponent(plan.teamId)}/callback`, plan.body, fetcher);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof LiteLLMHttpError && e.status === 404
          ? 'team-callback API not on this LiteLLM version (404)'
          : (e as Error).message,
    };
  }
}

/** Disable a team's callback logging (POST /team/{id}/disable_logging). NEVER throws. */
export async function disableTeamLogging(teamId: string, fetcher: Fetcher = fetch): Promise<CallbackWriteResult> {
  if (!litellmHttpConfigured()) {
    return { ok: false, error: 'LiteLLM not configured (OFFGRID_LITELLM_URL unset)' };
  }
  try {
    await litellmPost(`/team/${encodeURIComponent(teamId)}/disable_logging`, {}, fetcher);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof LiteLLMHttpError && e.status === 404
          ? 'team-logging API not on this LiteLLM version (404)'
          : (e as Error).message,
    };
  }
}

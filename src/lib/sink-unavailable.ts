// ─── Why a backing store could not answer ────────────────────────────────────────────────────────────
//
// The gateway Logs surface read "Logs unavailable — the OpenSearch history sink is offline." while
// OpenSearch was UP and answering 401: the route did `if (!r.ok) return { available: false }`, so every
// non-OK response — a rejected credential, a missing index, a 500 — collapsed into one word, "offline".
//
// That is worse than showing nothing. It names a cause that is false, and it sends an operator to
// restart a healthy service instead of fixing the credential. Same shape exists on the traffic and
// prompts routes, so the classification lives here once.
//
// Pure. Zero IO.

export type SinkFailure =
  | 'unauthorised'
  | 'forbidden'
  | 'missing-index'
  | 'unreachable'
  | 'not-configured'
  | 'error';

export interface SinkUnavailable {
  available: false;
  reason: SinkFailure;
  /** One sentence for the operator: what is actually wrong, and what fixes it. */
  message: string;
}

/**
 * Classify an HTTP status from a backing store.
 *
 * 401 and 403 are deliberately distinct: the first means our credential was rejected (or never sent),
 * the second means it was accepted and lacks rights. They have different fixes and conflating them
 * costs an operator an afternoon.
 */
export function classifySinkStatus(status: number, service = 'the log store'): SinkUnavailable {
  if (status === 401) {
    return {
      available: false,
      reason: 'unauthorised',
      message: `${service} is running but rejected our credentials — it is not offline. Check the stored credential for this service.`,
    };
  }
  if (status === 403) {
    return {
      available: false,
      reason: 'forbidden',
      message: `${service} accepted our credentials but refuses this read. The account needs permission on this index.`,
    };
  }
  if (status === 404) {
    return {
      available: false,
      reason: 'missing-index',
      message: `${service} is running but has no data yet for this view — nothing has been written to it.`,
    };
  }
  if (status === 0) {
    return {
      available: false,
      reason: 'unreachable',
      message: `${service} could not be reached at all. It may be down, or not reachable from the console.`,
    };
  }
  return {
    available: false,
    reason: 'error',
    message: `${service} returned an error (HTTP ${status}), so this view cannot be trusted to be complete.`,
  };
}

/** A thrown network error — genuinely unreachable, as distinct from a store that answered. */
export function sinkUnreachable(service = 'the log store'): SinkUnavailable {
  return {
    available: false,
    reason: 'unreachable',
    message: `${service} could not be reached at all. It may be down, or not reachable from the console.`,
  };
}

/** The store was never wired up — an absence of configuration, not a fault. */
export function sinkNotConfigured(service = 'the log store'): SinkUnavailable {
  return {
    available: false,
    reason: 'not-configured',
    message: `${service} is not configured for this deployment, so there is nothing to read.`,
  };
}

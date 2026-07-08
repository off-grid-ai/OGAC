// Wall-clock cap for a server-side probe. Pure (only the platform timer), zero I/O — the unit-
// testable seam that keeps a slow or unreachable backend from stalling a `force-dynamic` RSC render.
//
// WHY this exists: console pages fetch live per-request, org-scoped data (aggregator / Keycloak /
// OpenSearch / DB) directly in the server component body. Each fetch already has its own
// `AbortSignal.timeout(...)`, but those are loose (often 6s) and, stacked across the probes a page
// runs, add up to multi-second blank navigations. Worse, a hung DB query or a socket that never
// resolves has NO cap at all. `withTimeout` puts a single hard ceiling on the wall-clock time any
// one probe can cost the render, regardless of how the underlying call behaves: past `ms` it
// resolves the caller-supplied fallback (the same graceful-degrade contract as the `safe()` wrapper
// on the overview page) so the page renders NOW with a degraded tile instead of waiting.
//
// It never rejects — a timeout is a normal, expected outcome here, not an error — so it composes
// cleanly inside `Promise.all([...])` where one slow probe must not reject the whole batch.

export interface WithTimeoutOptions {
  /** Invoked when the fallback is returned because `ms` elapsed first. For logging/metrics. */
  onTimeout?: () => void;
}

/**
 * Race `promise` against a timer of `ms` milliseconds.
 *
 * - Resolves with the promise's value if it settles first.
 * - Resolves with `fallback` if `ms` elapses first (does NOT reject).
 * - If the promise REJECTS before the timeout, resolves with `fallback` too — a failing probe and a
 *   slow probe degrade identically, so callers never need a separate try/catch around this.
 *
 * The timer is always cleared, so a fast promise leaves no dangling handle to keep the event loop
 * (or a test process) alive.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  options?: WithTimeoutOptions,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      options?.onTimeout?.();
      resolve(fallback);
    }, ms);
    // Don't hold the event loop open just for this timer (Node); harmless where unref is absent.
    (timer as unknown as { unref?: () => void }).unref?.();

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * Convenience for the common `try { await fn() } catch { fallback }` + timeout pattern seen inline
 * in server pages (e.g. the overview `safe()` helper). Wraps a lazy thunk so a synchronous throw
 * while producing the promise also degrades to the fallback.
 */
export function safeWithTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  fallback: T,
  options?: WithTimeoutOptions,
): Promise<T> {
  let promise: Promise<T>;
  try {
    promise = fn();
  } catch {
    return Promise.resolve(fallback);
  }
  return withTimeout(promise, ms, fallback, options);
}

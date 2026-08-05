// Pure: should a read-only viewer's outgoing request be stopped in the BROWSER, before it is sent?
//
// WHY THIS EXISTS. The read-only demo account is what outsiders are given on the public links. The
// server-side block is complete and correct — the edge middleware 403s every mutating /api call — but
// the UI never knew, so all 216 write components rendered fully armed controls that failed on click.
// A stranger clicking "Add data source", filling the form and getting "Failed to add connector" reads
// that as a broken product, not as a permission they don't have.
//
// The fix has to be ONE seam, because there are 263 raw `fetch(` call sites and no shared client
// helper — editing them all would guarantee drift. So the browser's fetch is wrapped once and asks
// this function.
//
// THE RULE IS NOT A SECOND COPY OF THE SERVER'S RULE — it delegates to the same pure
// `isViewerWriteAttempt` the middleware calls. That matters: if the client were stricter it would
// refuse reads the server allows (which already happened once — the viewer couldn't search memory
// because the query travels in a POST body), and if it were looser it would promise writes the server
// refuses. Sharing the decision makes both impossible by construction.
//
// This is affordance only. Hiding or short-circuiting a control is NEVER the control; the middleware
// and the per-handler gates remain the enforcement, and a viewer who bypasses the UI still gets a 403.

import { isViewerWriteAttempt } from '@/lib/viewer-policy';

/**
 * Session-lifecycle routes, exempt regardless of method.
 *
 * NextAuth signs out with a POST. Blocking it would trap a viewer in the demo with no way out — the
 * one write every visitor must be able to perform. The middleware already treats `/api/auth` as a
 * public path for exactly this reason, so exempting it here keeps the two sides agreeing.
 *
 * A prefix is correct here (unlike READ_ONLY_QUERY_PATHS): the whole NextAuth route family is session
 * plumbing, and none of it touches tenant data.
 */
const SESSION_PATH_PREFIX = '/api/auth/';

/** Extract the HTTP method the way `fetch` resolves it: explicit init wins, then a Request, else GET. */
export function methodOf(
  init: { method?: string } | null | undefined,
  requestMethod?: string | null,
): string {
  return (init?.method ?? requestMethod ?? 'GET').toUpperCase();
}

/**
 * Decide whether to stop this request in the browser.
 *
 * `url` may be relative or absolute — it is resolved against `origin`, and a CROSS-ORIGIN request is
 * never intercepted: this is about our own API, and silently breaking a third-party call (analytics, a
 * font, a customer's own endpoint) would be a bug wearing a security costume.
 */
export function shouldBlockViewerRequest(
  role: string | null | undefined,
  method: string,
  url: string,
  origin: string,
): boolean {
  let target: URL;
  try {
    target = new URL(url, origin);
  } catch {
    // An unparseable URL is not ours to judge; let fetch fail on it as it normally would.
    return false;
  }
  if (target.origin !== origin) return false;
  if (!target.pathname.startsWith('/api/')) return false;
  if (target.pathname.startsWith(SESSION_PATH_PREFIX)) return false;
  // The pathname only — never the query string, matching what the middleware passes.
  return isViewerWriteAttempt(role, method, target.pathname);
}

// ─── Stale-bundle detection — PURE ──────────────────────────────────────────────────────────────────
//
// After a deploy, a tab that is still open holds the PREVIOUS build's page and keeps asking for JS
// chunks by their old hashed filenames. Those files no longer exist on the server, so it answers 400
// with an HTML error body; strict MIME checking then refuses to execute the response as a script, and
// React surfaces `ChunkLoadError: Loading chunk 26224 failed`.
//
// Nothing is wrong with the application. The tab is simply out of date, and the only cure is fetching
// fresh HTML — "Try again" re-renders the same stale bundle and fails identically.
//
// This matters more than a stray console error: a viewer with the console open during a deploy sees
// "Something went wrong here" on a product that is working perfectly.
//
// Zero-IO so the matching is unit-testable without a browser.

/**
 * Whether an error means "this tab is running an old build", as opposed to a genuine failure.
 *
 * Matched on name and message rather than `instanceof ChunkLoadError`: the error crosses a bundle
 * boundary, so the class identity is not reliable, and webpack/Next have used several wordings for the
 * same condition across versions.
 */
export function isStaleBundleError(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const text = `${error.name ?? ''} ${error.message ?? ''}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    text,
  );
}

/** sessionStorage key guarding against a reload loop when the fresh build is broken too. */
export const STALE_RELOAD_FLAG = 'og:chunk-reload';

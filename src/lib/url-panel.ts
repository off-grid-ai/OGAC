// Pure URL-query helpers for URL-driven side panels. Navigational position (which create/edit
// panel is open, and for which entity) lives in the URL — never in local component state — so the
// browser Back button steps out of a panel and panels are deep-linkable. These functions are
// zero-import and side-effect-free so they can be unit-tested without a router.

/**
 * Compute the next query string after setting/clearing panel params on top of `current`.
 * A `null` value deletes the key. Returns the query string WITHOUT a leading "?".
 */
export function withPanelParams(
  current: string,
  updates: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return next.toString();
}

/** Build a full "path?query" href, omitting the "?" when the query is empty. */
export function panelHref(pathname: string, query: string): string {
  return query ? `${pathname}?${query}` : pathname;
}

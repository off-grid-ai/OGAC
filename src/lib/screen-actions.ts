// ─── Turning a page's own links into calls to action (PURE, zero-IO) ─────────────────────────────
//
// The guide's answer ends with a next step — "review the Underwriter decision step to approve or
// reject the case" — and used to leave the reader to go and find it. The obvious fix, having the
// model emit a link, is the wrong one: it would be inventing routes, and a confident CTA to a page
// that does not exist is worse than no CTA. The page already carries its actions as real anchors, so
// we take those. Accurate by construction, impossible to fake.
//
// This file is the naming half — the part worth testing. The DOM walk stays in the component.

/** Link text that says nothing on its own. Every card on a list page has one of these. */
const GENERIC_LABEL = /^(open|view|details|see|go|more|link|shared link|edit|manage)$/i;

/** Longest label worth showing. Past this it is a paragraph wearing a button. */
const MAX_LABEL = 60;

/**
 * An anchor's text as a reader would say it.
 *
 * `textContent` concatenates adjacent elements with nothing between them, so
 * `<span>Runs on:</span><span>Policy Underwriting</span>` came out as "Runs on:Policy Underwriting" —
 * the space was only ever implied by the layout, and reading the text is what loses the layout.
 */
export function normalizeLinkText(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  // A colon immediately followed by a letter is a lost boundary. Bounded to letters, so a time
  // ("09:30") and a machine reference are left alone.
  return text.replace(/:(?=[A-Za-z])/g, ': ');
}

/**
 * What to call this action in the panel.
 *
 * A bare "Open" is meaningless once it is out of its card, so a generic label borrows the heading it
 * sat under: "Open · Policy Underwriting Assist". A label that already says something keeps its own
 * words — prefixing those too would produce "Start from a template · Apps", which reads worse.
 */
export function actionLabel(text: string | null | undefined, context?: string | null): string {
  const label = normalizeLinkText(text);
  if (!label) return '';
  const heading = normalizeLinkText(context);
  const full = GENERIC_LABEL.test(label) && heading ? `${label} · ${heading}` : label;
  return full.length > MAX_LABEL ? `${full.slice(0, MAX_LABEL - 1).trimEnd()}…` : full;
}

/**
 * Is this a link the guide should offer?
 *
 * Internal routes only: an external link is not somewhere this surface should be steering anyone.
 * Empty and essay-length text are both rejected — the first has nothing to press, the second is not
 * a call to action.
 */
export function isOfferableAction(href: string | null | undefined, text: string | null | undefined): boolean {
  const h = String(href ?? '');
  if (!h.startsWith('/') || h.startsWith('//')) return false;
  const t = normalizeLinkText(text);
  return t.length > 0 && t.length <= 48;
}

// ─── What the guide asks when it explains the page you are on ─────────────────────────────────────
//
// The guide has two modes. "Show me around" offers the curated tour questions; "Explain this page"
// answers for wherever the reader currently is. This file owns the wording of the second one.
//
// It is pure and separate from the component because this sentence IS the product surface — it
// decides what a stranger is told about a screen — and a component is a poor place to keep a string
// you want to be able to test and change deliberately.

export interface PageExplanationRequest {
  /** The route's own title, e.g. "Evidence". */
  title: string;
  /** The section it sits under, e.g. "Governance". */
  eyebrow?: string;
  /** The route's one-line description, when it has one. */
  description?: string;
  /**
   * What is actually ON the screen right now — the figures, rows and names the reader can see.
   *
   * Without it the answer is a definition. Asked about Apps, the guide replied that the page "displays
   * pre-built business use cases and AI agents designed for the full lifecycle of your organization":
   * true of every tenant, and therefore worth nothing to the one reading it. The useful answer names
   * what is in front of them — how many apps, which are live, what is waiting.
   */
  content?: string;
}

/**
 * The question the guide is asked for a page.
 *
 * It names the SECTION as well as the page because several routes share a leaf name — Overview,
 * Audit and Export each exist in more than one place — and "explain Overview" is unanswerable. It
 * asks for the two things a newcomer actually needs: what this screen is for, and what to look at
 * first. The page's own description is included when it has one, so the model is grounded in how the
 * product already describes itself rather than inventing a purpose for the screen.
 */
export function pageExplanationQuestion(request: PageExplanationRequest): string {
  const where = [request.eyebrow, request.title].filter(Boolean).join(' → ');
  const detail = request.description ? ` The page describes itself as: ${request.description}.` : '';
  // The screen's contents go in as a labelled block rather than woven into the sentence: it is data,
  // not part of the question, and the model needs to be able to tell those apart.
  const onScreen = request.content
    ? `\n\nWhat is on the screen right now:\n${request.content}`
    : '';
  return `Explain the "${where}" page to me.${detail} What is it for, what am I looking at, and what should I check first?${onScreen}`;
}

/**
 * Is this the guide asking about a screen rather than about the platform's records?
 *
 * It matters because the two need opposite handling. A question about the platform is answered FROM
 * the records, and having none is a real answer ("I don't have records about that"). A question about
 * a SCREEN is not: asked to explain the Work page, the copilot replied "I have no platform records to
 * answer this question yet. Check that the relevant module is configured" — which is both untrue and
 * unanswerable nonsense to someone who only wanted to know what they were looking at. The page always
 * exists; explaining it never depended on a record.
 *
 * Matched on the sentence this file owns, so the two stay in step by construction.
 */
export function isPageExplanation(question: string | null | undefined): boolean {
  return /^Explain the "[^"]*" page to me\./.test(String(question ?? '').trim());
}

// ─── Prompt template helpers (PURE, client-safe) ───────────────────────────────────────────────────
// Zero-IO string logic for {{variable}} prompt templates, split out of prompts.ts (which pulls in the
// DB) so CLIENT components (the prompt DETAIL "fill & copy" preview + the Playground) can import it
// without dragging `pg` into the browser bundle. prompts.ts re-exports these for server callers.

/** Extract distinct {{variable}} placeholders from a prompt body, in order of first appearance.
 *  A partial reference `{{>name}}` is NOT a variable — it is skipped here (see extractPartialRefs). */
export function extractVariables(content: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Render a prompt template by substituting {{variable}} placeholders with supplied values. An unfilled
 * (missing or empty-string) variable is left as its literal {{name}} so the operator sees exactly which
 * slots still need a value. Values are substituted verbatim.
 */
export function renderPromptTemplate(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, rawName: string) => {
    const name = rawName.trim();
    const v = values[name];
    return v !== undefined && v !== '' ? v : whole;
  });
}

// ─── Partials: reusable prompt fragments composed via {{>partial-name}} ──────────────────────────────
// A partial is a named, reusable fragment. A prompt references one with a Handlebars-style
// `{{>partial-name}}` token; the renderer inlines the fragment's body in place (recursively, so a
// partial can itself compose other partials). Inlining is a PURE map lookup — the DB layer resolves
// names to bodies, then hands this function the map. Cycles and unknown partials are surfaced honestly,
// never silently dropped.

const PARTIAL_REF_RE = /\{\{\s*>\s*([\w.-]+)\s*\}\}/g;

/** Extract distinct `{{>partial-name}}` references from a body, in order of first appearance. */
export function extractPartialRefs(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PARTIAL_REF_RE.source, 'g');
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export interface InlineResult {
  /** The content with every resolvable `{{>partial}}` reference replaced by its body. */
  content: string;
  /** Partial names referenced but not present in the supplied map (left as their literal token). */
  missing: string[];
  /** Partial names that formed a reference cycle (left as their literal token, not expanded further). */
  cyclic: string[];
}

const MAX_PARTIAL_DEPTH = 20;

/**
 * Inline every `{{>partial-name}}` reference in `content` using the supplied name→body map, PURE and
 * recursive so a partial may compose other partials. Unknown references are left as their literal
 * `{{>name}}` token and reported in `missing`; a reference cycle stops expanding at the repeat and is
 * reported in `cyclic`. A depth cap is a final backstop. Zero I/O — the caller resolves the map.
 */
export function inlinePartials(content: string, partials: Record<string, string>): InlineResult {
  const missing = new Set<string>();
  const cyclic = new Set<string>();

  function expand(text: string, stack: string[], depth: number): string {
    if (depth > MAX_PARTIAL_DEPTH) return text;
    return text.replace(new RegExp(PARTIAL_REF_RE.source, 'g'), (whole, rawName: string) => {
      const name = rawName.trim();
      if (!(name in partials)) {
        missing.add(name);
        return whole;
      }
      if (stack.includes(name)) {
        cyclic.add(name);
        return whole;
      }
      return expand(partials[name], [...stack, name], depth + 1);
    });
  }

  return { content: expand(content, [], 0), missing: [...missing], cyclic: [...cyclic] };
}

/**
 * Full render: inline partials FIRST (so a partial's own {{variables}} become fillable), then
 * substitute {{variable}} values. Returns the rendered text plus the partial-resolution diagnostics.
 */
export function renderPromptWithPartials(
  content: string,
  values: Record<string, string>,
  partials: Record<string, string>,
): InlineResult & { rendered: string } {
  const inlined = inlinePartials(content, partials);
  return { ...inlined, rendered: renderPromptTemplate(inlined.content, values) };
}

// ─── Prompt template helpers (PURE, client-safe) ───────────────────────────────────────────────────
// Zero-IO string logic for {{variable}} prompt templates, split out of prompts.ts (which pulls in the
// DB) so CLIENT components (the prompt DETAIL "fill & copy" preview) can import it without dragging
// `pg` into the browser bundle. prompts.ts re-exports these for server callers.

/** Extract distinct {{variable}} placeholders from a prompt body, in order of first appearance. */
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

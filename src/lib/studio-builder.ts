// PURE logic for the non-technical Studio builder — ZERO imports, ZERO I/O, so it's fully
// unit-testable. Phase 4.5: a non-technical user describes an assistant in plain language; Studio
// turns that into the payloads that create a governed agent + a saved template. The heavy lifting
// (model choice, params, embeddings, Temporal) is hidden — this module just shapes the two payloads
// the builder POSTs to the EXISTING routes (/admin/agents to create the agent, /studio/templates to
// save it). A Studio assistant IS a custom agent + a template that points at it.
//
// Keeping this pure means the "infer the wiring from a plain-language goal" rules are testable
// without a DB, a gateway, or a browser.

export interface BuilderInput {
  goal: string; // plain-language description of what the assistant should do
  title?: string; // optional friendly name; derived from the goal if absent
  toolIds?: string[]; // ids of org tools the assistant may use (its "skills")
  grounded?: boolean; // "search uploaded knowledge" — retrieval grounding on
  visibility?: 'private' | 'org' | 'public';
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  value?: Required<Pick<BuilderInput, 'goal' | 'title' | 'grounded' | 'visibility'>> & {
    toolIds: string[];
  };
}

// Derive a friendly title from the goal: the first ~6 words, title-cased-ish, capped. Falls back to
// a generic name so a title is never empty.
export function deriveTitle(goal: string): string {
  const words = goal.trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  const t = words.replace(/[.:!?,;]+$/, '').trim();
  if (!t) return 'New assistant';
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

const VISIBILITIES = ['private', 'org', 'public'] as const;

export function validateBuilderInput(input: Partial<BuilderInput> | null | undefined): ValidationResult {
  if (!input) return { ok: false, error: 'missing input' };
  const goal = (input.goal ?? '').trim();
  if (goal.length < 10) {
    return { ok: false, error: 'Describe what the assistant should do (at least a sentence).' };
  }
  if (goal.length > 4000) return { ok: false, error: 'Description is too long (max 4000 chars).' };
  const visibility = VISIBILITIES.includes(input.visibility as never)
    ? (input.visibility as 'private' | 'org' | 'public')
    : 'private';
  const toolIds = Array.isArray(input.toolIds)
    ? input.toolIds.filter((t): t is string => typeof t === 'string')
    : [];
  const title = (input.title ?? '').trim() || deriveTitle(goal);
  return {
    ok: true,
    value: { goal, title, grounded: input.grounded !== false, visibility, toolIds },
  };
}

// The payload for POST /api/v1/admin/agents — the goal becomes the agent's instructions; skills
// become its tools; grounding is on by default so it cites uploaded knowledge and can't hallucinate.
export function buildAgentPayload(v: NonNullable<ValidationResult['value']>) {
  return {
    name: v.title,
    role: 'Studio',
    systemPrompt: v.goal,
    tools: v.toolIds,
    grounded: v.grounded,
    trigger: 'on-demand' as const,
  };
}

// The payload for POST /api/v1/studio/templates — a workflow whose single Agent node points at the
// agent just created, so the existing template runner executes it through the governed pipeline.
// `deploy` (publish) is set when visibility is public, which also mints the shareable /app/<slug>.
export function buildTemplatePayload(
  agentId: string,
  v: NonNullable<ValidationResult['value']>,
) {
  return {
    title: v.title,
    summary: v.goal.slice(0, 200),
    prompt: v.goal,
    visibility: v.visibility,
    deploy: v.visibility === 'public',
    workflow: {
      title: v.title,
      summary: v.goal.slice(0, 200),
      nodeIds: [`agent:${agentId}`],
      edges: [],
    },
  };
}

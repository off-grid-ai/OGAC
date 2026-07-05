// PURE logic for the non-technical Studio builder — ZERO imports, ZERO I/O, so it's fully
// unit-testable. Phase 4.5: a non-technical user describes an assistant in plain language across a
// 4-step guided wizard (goal → skills → data → publish); Studio turns that into the payloads that
// create a governed agent + a saved template. The heavy lifting (model choice, params, embeddings,
// Temporal) is hidden — this module shapes the two payloads the builder POSTs to the EXISTING routes
// (/admin/agents to create the agent, /studio/templates to save it). A Studio assistant IS a custom
// agent + a template that points at it, run through the same governed pipeline as everything else.
//
// The core value is the plain-language → config translation: `planAssistant` maps
// { goal, chosen skills, chosen data, template } → { systemPrompt, skillList, collectionIds,
// suggestedModel, grounded, title }. Keeping it pure means the "infer the wiring from a goal" rules
// are testable without a DB, a gateway, or a browser.

export type Visibility = 'private' | 'org' | 'public';

// ─── Guided templates ─────────────────────────────────────────────────────────
// Starting points for someone who doesn't know what to type. Each seeds the goal text and the
// grounding default; the plain-language mapper does the rest. `promptSkill` prompts encoded as
// keyword hints the skill matcher can lean on when auto-selecting tools.
export interface GuidedTemplate {
  id: string;
  label: string;
  blurb: string; // one line explaining the outcome, not the feature
  goal: string; // seeds the goal textarea
  grounded: boolean; // sensible default for this kind of assistant
  skillHints: string[]; // keywords that hint which org skills likely apply
}

export const GUIDED_TEMPLATES: GuidedTemplate[] = [
  {
    id: 'summarize-and-tag',
    label: 'Summarize & tag',
    blurb: 'Turn long docs or tickets into a short summary plus tidy labels.',
    goal:
      'Read what I give you and produce a short, faithful summary followed by 3–5 tags that ' +
      'classify it by topic and priority. Keep the summary under 5 sentences.',
    grounded: false,
    skillHints: ['summarize', 'tag', 'classify'],
  },
  {
    id: 'kyc-check',
    label: 'KYC check',
    blurb: 'Screen a customer profile against our onboarding rules and flag risks.',
    goal:
      'Review the customer details I provide against our KYC and onboarding policy. Point out any ' +
      'missing information, red flags, or checks that still need to be done, and always cite the ' +
      'exact policy rule you relied on.',
    grounded: true,
    skillHints: ['search', 'lookup', 'crm', 'verify'],
  },
  {
    id: 'support-answer',
    label: 'Support answer',
    blurb: 'Answer customer questions from our own docs, with sources.',
    goal:
      'Answer customer support questions using only our documented knowledge. Be concise and ' +
      'friendly, and always cite the article or policy you used. If the answer is not in our ' +
      'knowledge, say so and offer to escalate.',
    grounded: true,
    skillHints: ['search', 'knowledge', 'answer'],
  },
  {
    id: 'sop-synth',
    label: 'SOP synthesizer',
    blurb: 'Draft a clear step-by-step procedure from scattered notes.',
    goal:
      'Take the notes and context I provide and synthesize a clear, numbered standard operating ' +
      'procedure. Use plain language, group related steps, and call out any prerequisites or ' +
      'warnings. Ground it in our existing documentation where possible.',
    grounded: true,
    skillHints: ['search', 'knowledge', 'generate', 'document', 'doc'],
  },
  {
    id: 'blank',
    label: 'Start from scratch',
    blurb: 'Describe your own assistant in your own words.',
    goal: '',
    grounded: true,
    skillHints: [],
  },
];

export function getTemplate(id: string | undefined | null): GuidedTemplate | undefined {
  return GUIDED_TEMPLATES.find((t) => t.id === id);
}

// ─── Input + validation ─────────────────────────────────────────────────────────
export interface BuilderInput {
  goal: string; // plain-language description of what the assistant should do
  title?: string; // optional friendly name; derived from the goal if absent
  templateId?: string; // guided starting point (informational; shapes defaults in the UI)
  toolIds?: string[]; // ids of org tools the assistant may use (its "skills")
  collectionIds?: string[]; // ids of org knowledge collections it may draw on (the "data")
  grounded?: boolean; // "answer from our knowledge" — retrieval grounding on
  visibility?: Visibility;
}

export interface NormalizedInput {
  goal: string;
  title: string;
  templateId: string;
  toolIds: string[];
  collectionIds: string[];
  grounded: boolean;
  visibility: Visibility;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  value?: NormalizedInput;
}

// Derive a friendly title from the goal: the first ~6 words, capped. Falls back to a generic name so
// a title is never empty.
export function deriveTitle(goal: string): string {
  const words = goal.trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  const t = words.replace(/[.:!?,;]+$/, '').trim();
  if (!t) return 'New assistant';
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

const VISIBILITIES: Visibility[] = ['private', 'org', 'public'];

export function validateBuilderInput(
  input: Partial<BuilderInput> | null | undefined,
): ValidationResult {
  if (!input) return { ok: false, error: 'missing input' };
  const goal = (input.goal ?? '').trim();
  if (goal.length < 10) {
    return { ok: false, error: 'Describe what the assistant should do (at least a sentence).' };
  }
  if (goal.length > 4000) return { ok: false, error: 'Description is too long (max 4000 chars).' };
  const visibility = VISIBILITIES.includes(input.visibility as Visibility)
    ? (input.visibility as Visibility)
    : 'private';
  const toolIds = uniqueStrings(input.toolIds);
  const collectionIds = uniqueStrings(input.collectionIds);
  const templateId = typeof input.templateId === 'string' ? input.templateId : '';
  // Grounding defaults on unless explicitly turned off, or the chosen template prefers it off and
  // the user hasn't overridden it. If the user picked collections, grounding is implied on.
  const tpl = getTemplate(templateId);
  let grounded: boolean;
  if (typeof input.grounded === 'boolean') grounded = input.grounded;
  else if (tpl) grounded = tpl.grounded;
  else grounded = true;
  if (collectionIds.length > 0) grounded = true;
  const title = (input.title ?? '').trim() || deriveTitle(goal);
  return { ok: true, value: { goal, title, templateId, toolIds, collectionIds, grounded, visibility } };
}

function uniqueStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const x of v) if (typeof x === 'string' && x && !seen.has(x)) seen.add(x);
  return Array.from(seen);
}

// ─── The plain-language → config mapper (the core value) ────────────────────────
// Turns the normalized wizard input into the concrete assistant configuration. This is what a
// non-technical user gets for free: a real system prompt, the resolved skill list, the collection(s)
// grounding will draw on, and a sensible model — none of which they had to name.
export interface Skill {
  id: string;
  name: string;
  description?: string;
}
export interface DataCollection {
  id: string;
  name: string;
  description?: string;
}
export interface PlanContext {
  skills?: Skill[]; // the org's available tools, for name-resolution in the prompt
  collections?: DataCollection[]; // the org's available knowledge collections
  allowedModels?: string[]; // models the org's policy permits (first is the default hint)
}
export interface AssistantPlan {
  title: string;
  systemPrompt: string; // the generated, ready-to-run instructions
  skillList: string[]; // resolved tool ids the agent may call
  skillNames: string[]; // human-readable skill names (for the review screen)
  collectionIds: string[]; // knowledge collections the assistant is scoped to
  collectionNames: string[];
  grounded: boolean;
  suggestedModel: string; // '' means "use the platform default" (honest — never invents a model)
  visibility: Visibility;
}

const GROUNDED_CLAUSE =
  'Answer only from the knowledge and documents made available to you, and cite the specific ' +
  'source you used. If the answer is not in that knowledge, say so plainly — never guess or make ' +
  'up facts.';
const UNGROUNDED_CLAUSE =
  'Answer helpfully and concisely from your general capabilities. When you are unsure, say so ' +
  'rather than guessing.';

// Compose the system prompt from the plain-language goal + the resolved wiring. Deterministic so it
// is unit-testable and identical every time for the same input (no model call needed for the base
// prompt — the gateway "suggest" endpoint only refines names/skills, never fabricates the contract).
export function composeSystemPrompt(
  goal: string,
  grounded: boolean,
  skillNames: string[],
  collectionNames: string[],
): string {
  const lines: string[] = [goal.trim()];
  if (skillNames.length) {
    lines.push(
      `You can use these tools when they help: ${skillNames.join(', ')}. ` +
        'Only use a tool when the request clearly needs it.',
    );
  }
  if (grounded) {
    if (collectionNames.length) {
      lines.push(`Draw on this knowledge: ${collectionNames.join(', ')}.`);
    }
    lines.push(GROUNDED_CLAUSE);
  } else {
    lines.push(UNGROUNDED_CLAUSE);
  }
  return lines.join('\n\n');
}

// Suggest a model from the org's allowed list. We never invent a model name: if the org has an
// allow-list we take the first (the policy's default), otherwise we return '' meaning "let the
// platform default apply" (agentrun falls back to ANSWER_MODEL). Honest by construction.
export function suggestModel(allowedModels: string[] | undefined): string {
  const list = Array.isArray(allowedModels) ? allowedModels.filter((m) => typeof m === 'string' && m) : [];
  return list[0] ?? '';
}

export function planAssistant(v: NormalizedInput, ctx: PlanContext = {}): AssistantPlan {
  const skillById = new Map((ctx.skills ?? []).map((s) => [s.id, s]));
  const collById = new Map((ctx.collections ?? []).map((c) => [c.id, c]));
  // Resolve only ids that actually exist in the org catalog (drop stale/unknown ids).
  const skillList = v.toolIds.filter((id) => skillById.has(id));
  const skillNames = skillList.map((id) => skillById.get(id)!.name);
  const collectionIds = v.collectionIds.filter((id) => collById.has(id));
  const collectionNames = collectionIds.map((id) => collById.get(id)!.name);
  return {
    title: v.title,
    systemPrompt: composeSystemPrompt(v.goal, v.grounded, skillNames, collectionNames),
    skillList,
    skillNames,
    collectionIds,
    collectionNames,
    grounded: v.grounded,
    suggestedModel: suggestModel(ctx.allowedModels),
    visibility: v.visibility,
  };
}

// ─── Payloads for the existing routes ───────────────────────────────────────────
// POST /api/v1/admin/agents — the generated system prompt becomes the agent's instructions; the
// resolved skills become its tools; the suggested model is passed through (empty → platform default);
// grounding drives whether retrieval runs. Nothing here is a new runtime — it's the same custom-agent
// create path used everywhere else.
export function buildAgentPayload(plan: AssistantPlan) {
  return {
    name: plan.title,
    role: 'Studio',
    systemPrompt: plan.systemPrompt,
    model: plan.suggestedModel,
    tools: plan.skillList,
    grounded: plan.grounded,
    trigger: 'on-demand' as const,
  };
}

// POST /api/v1/studio/templates — a workflow whose single Agent node points at the created agent, so
// the existing template runner executes it through the governed pipeline. Chosen data collections are
// recorded as `data:<id>` nodes so the review screen + the deployed app show what it draws on (the
// permission-aware retrieval still scopes at run time by the caller's role — we never widen access).
// `deploy` (publish) is set when visibility is public, which also mints the shareable /app/<slug>.
export function buildTemplatePayload(agentId: string, plan: AssistantPlan) {
  const nodeIds = [`agent:${agentId}`, ...plan.collectionIds.map((id) => `data:${id}`)];
  return {
    title: plan.title,
    summary: plan.systemPrompt.slice(0, 200),
    prompt: plan.systemPrompt,
    visibility: plan.visibility,
    deploy: plan.visibility === 'public',
    workflow: {
      title: plan.title,
      summary: plan.systemPrompt.slice(0, 200),
      nodeIds,
      edges: [],
    },
  };
}

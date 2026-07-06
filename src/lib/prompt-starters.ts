// Curated starter library of common reusable system prompts / templates. Pure catalog + a payload
// builder — zero imports, unit-testable. The Prompts UI renders this and, on "Add to my prompts",
// posts the builder's output through the EXISTING create path (POST /api/v1/prompts →
// createPrompt(owner, { title, content, tags, visibility })). No new storage.

// One entry in the starter library. `content` uses the same {{variable}} placeholder convention the
// prompt library extracts, so added starters get their variables detected automatically.
export interface PromptStarter {
  id: string; // stable slug, used as a React key and for lookup — not persisted
  title: string;
  group: PromptStarterGroup;
  description: string; // one-line "what this does", shown on the card
  content: string;
  tags: string[];
}

export type PromptStarterGroup =
  | 'Summarize & extract'
  | 'Support & comms'
  | 'Documents & SOPs'
  | 'Classify & transform';

export const PROMPT_STARTER_GROUPS: readonly PromptStarterGroup[] = [
  'Summarize & extract',
  'Support & comms',
  'Documents & SOPs',
  'Classify & transform',
];

// The create payload the Prompts POST route accepts. Mirrors createPrompt's second arg exactly so
// the UI can JSON.stringify this straight into fetch('/api/v1/prompts', { method: 'POST', ... }).
export interface PromptCreatePayload {
  title: string;
  content: string;
  tags: string[];
  visibility: 'private' | 'org';
}

// Build the create payload for a starter. Every starter carries a "starter" tag (plus its own tags)
// so added prompts are traceable back to the library. Visibility defaults to private; callers can
// share to org. Pure — same input always yields the same payload.
export function buildPromptPayload(
  starter: PromptStarter,
  opts: { visibility?: 'private' | 'org' } = {},
): PromptCreatePayload {
  const tags = ['starter', ...starter.tags];
  const deduped: string[] = [];
  for (const t of tags) {
    const v = t.trim().toLowerCase();
    if (v && !deduped.includes(v)) deduped.push(v);
  }
  return {
    title: starter.title,
    content: starter.content,
    tags: deduped,
    visibility: opts.visibility === 'org' ? 'org' : 'private',
  };
}

// Case-insensitive search across title, description, content, and tags. Empty query returns all.
export function searchStarters(starters: PromptStarter[], query: string): PromptStarter[] {
  const q = query.trim().toLowerCase();
  if (!q) return starters;
  return starters.filter((s) => {
    const hay = [s.title, s.description, s.content, ...s.tags].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

// Group starters by use-case, preserving PROMPT_STARTER_GROUPS order and dropping empty groups.
export function groupStarters(
  starters: PromptStarter[],
): Array<{ group: PromptStarterGroup; items: PromptStarter[] }> {
  return PROMPT_STARTER_GROUPS.map((group) => ({
    group,
    items: starters.filter((s) => s.group === group),
  })).filter((g) => g.items.length > 0);
}

export const PROMPT_STARTERS: readonly PromptStarter[] = [
  {
    id: 'summarize-and-tag',
    title: 'Summarize & tag',
    group: 'Summarize & extract',
    description: 'Condense any text into a short summary plus topic tags.',
    tags: ['summary', 'tagging'],
    content: `Summarize the text below in 3–5 sentences, then list 3–7 topic tags.

Rules:
- Keep the summary factual; do not add opinions or information not in the text.
- Tags are lowercase, single words or short phrases, comma-separated.

Return exactly:
Summary: <your summary>
Tags: <tag1, tag2, …>

Text:
{{text}}`,
  },
  {
    id: 'extract-to-json',
    title: 'Extract to JSON',
    group: 'Summarize & extract',
    description: 'Pull structured fields out of freeform text into strict JSON.',
    tags: ['extraction', 'json', 'structured'],
    content: `Extract the following fields from the text and return ONLY valid JSON — no prose, no code fences.

Fields to extract:
{{fields}}

Rules:
- If a field is not present, use null. Never guess.
- Do not add fields that were not requested.
- Output must parse as JSON.

Text:
{{text}}`,
  },
  {
    id: 'meeting-notes',
    title: 'Meeting notes → action items',
    group: 'Summarize & extract',
    description: 'Turn a raw transcript into decisions, action items, and owners.',
    tags: ['meeting', 'notes', 'action-items'],
    content: `Turn the meeting transcript below into structured notes.

Return these sections:
1. Summary — 2–3 sentences.
2. Decisions — bullet list of what was decided.
3. Action items — bullet list as "[owner] — [task] — [due date if stated, else TBD]".
4. Open questions — anything unresolved.

Only use information present in the transcript.

Transcript:
{{transcript}}`,
  },
  {
    id: 'support-reply-grounded',
    title: 'Grounded support reply',
    group: 'Support & comms',
    description: 'Draft a customer reply grounded ONLY in provided knowledge — no invention.',
    tags: ['support', 'customer', 'grounded'],
    content: `You are a support agent. Write a reply to the customer message using ONLY the knowledge provided below.

Rules:
- Answer strictly from the knowledge. If it does not cover the question, say you'll escalate and do not invent an answer.
- Tone: {{tone}} (e.g. warm, concise, professional).
- Do not promise anything not stated in the knowledge.

Knowledge:
{{knowledge}}

Customer message:
{{message}}`,
  },
  {
    id: 'translate',
    title: 'Translate (preserve meaning)',
    group: 'Support & comms',
    description: 'Translate text into a target language, keeping tone and formatting.',
    tags: ['translation', 'localization'],
    content: `Translate the text below into {{target_language}}.

Rules:
- Preserve meaning, tone, and formatting (lists, line breaks, placeholders like {name}).
- Do not translate proper nouns, code, or product names unless they have a standard localized form.
- Return only the translation, no notes.

Text:
{{text}}`,
  },
  {
    id: 'sop-writer',
    title: 'SOP writer',
    group: 'Documents & SOPs',
    description: 'Turn a rough process description into a clean step-by-step SOP.',
    tags: ['sop', 'process', 'documentation'],
    content: `Write a Standard Operating Procedure (SOP) for the process described below.

Structure:
- Title
- Purpose (1–2 sentences)
- Scope / when to use
- Prerequisites
- Steps (numbered, each a single clear action)
- Verification (how to confirm it worked)
- Rollback / what to do if a step fails

Keep steps concrete and in the imperative. Use only the details provided; mark gaps as "[TBD — confirm with owner]".

Process description:
{{process}}`,
  },
  {
    id: 'redline-contract',
    title: 'Redline / review clause',
    group: 'Documents & SOPs',
    description: 'Review a contract clause for risk and suggest safer wording.',
    tags: ['legal', 'contract', 'review'],
    content: `Review the contract clause below from the perspective of {{party}}.

Return:
1. Plain-language explanation — what this clause means.
2. Risks — anything unfavorable, ambiguous, or one-sided, with severity (low/medium/high).
3. Suggested redline — proposed replacement wording that reduces the risk.

This is a drafting aid, not legal advice. Flag anything that clearly needs a qualified lawyer.

Clause:
{{clause}}`,
  },
  {
    id: 'classify-intent',
    title: 'Classify intent',
    group: 'Classify & transform',
    description: 'Assign an input to one of a fixed set of labels, with confidence.',
    tags: ['classification', 'routing', 'intent'],
    content: `Classify the input below into exactly one of these labels:
{{labels}}

Rules:
- Choose the single best label. If none fit, use "other".
- Return only JSON: {"label": "<label>", "confidence": <0.0–1.0>, "reason": "<one short sentence>"}.

Input:
{{input}}`,
  },
  {
    id: 'rewrite-clarity',
    title: 'Rewrite for clarity',
    group: 'Classify & transform',
    description: 'Rewrite text to be clearer and tighter without changing meaning.',
    tags: ['rewrite', 'editing', 'clarity'],
    content: `Rewrite the text below to be clearer and more concise.

Rules:
- Preserve the original meaning and any facts. Do not add new information.
- Prefer plain words and short sentences. Keep the same audience and reading level: {{audience}}.
- Return only the rewritten text.

Text:
{{text}}`,
  },
];

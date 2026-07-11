// ─── NL → AppSpec compiler (Builder Epic Phase 2C, task #106 — the keystone) ─────────────────────
//
// THE GOAL: a non-technical user describes a real multi-step process in plain language and gets a
// runnable, GOVERNED AppSpec. Canonical example (MUST work):
//
//   "reimbursement approval — read the invoice, check the employee's quota, check if they've
//    exceeded and are eligible, then approve/reject"
//
//   → [connector-query: invoices] → [connector-query: reimbursement quota]
//     → [agent: eligibility decision, grounded] → [human: review/approve] → [output]
//
// TWO COMPILE PATHS, one contract:
//   • LLM path — the gateway decomposes the description into ordered steps. We CONSTRAIN it to only
//     reference declared data-domains + existing tools, then re-validate every binding ourselves.
//   • Deterministic heuristic fallback (no gateway / junk output) — keyword-segment the description
//     into steps and bind data-ish phrases with the SAME rule engine. Mirrors compose/route.ts.
//
// HONESTY (Builder Epic risk #5, NON-NEGOTIABLE — the product's credibility):
//   Every connector-query step MUST bind to a domain that `resolveDomain` actually resolves against
//   the org's DECLARED domains. If a step needs data with no declared domain, we DO NOT fabricate a
//   connector — we drop the connector-query step and surface a gap ("No data source declared for
//   'invoices' — add a data-domain mapping"). We NEVER invent a connector / domain / tool. The LLM's
//   claimed bindings are treated as UNTRUSTED and re-resolved through the deterministic resolver.
//
// SOLID: the decomposition + binding + gap logic is PURE (zero-IO, unit-tested below the route). The
// only I/O is (a) assembling org context and (b) the optional gateway call — both injected so tests
// run without live services. The route (api/v1/admin/apps/compile) is a thin auth-gated shell.

import {
  type AppEdge,
  type AppSpec,
  type AppStep,
  type ConnectorQueryStep,
  validateAppSpec,
} from '@/lib/app-model';
import { type DataDomain, resolveDomain } from '@/lib/data-domains';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import { getOrgContext } from '@/lib/org-context';

// ─── Result contract ───────────────────────────────────────────────────────────────────────────
export interface CompileResult {
  spec: AppSpec;
  /** Honest report of what could NOT be wired: unbindable data phrases, missing tools, validation
   *  issues. Never hidden — a gap is surfaced, never faked into a fabricated connector. */
  gaps: string[];
}

export interface CompileCtx {
  orgId: string;
  ownerId: string;
}

// ─── Dependency seams (injected in tests; real defaults in prod) ─────────────────────────────────
// The compiler is pure logic + two boundaries. We inject them so tests exercise the REAL
// decomposition/binding/gap rules without a live gateway or DB.
export interface CompileDeps {
  /** Load the org's declared data-domains (the only things a connector-query may bind to). */
  loadDomains: (orgId: string) => Promise<DataDomain[]>;
  /** Ask the model to decompose the description into a step plan. Returns null when unavailable /
   *  junk — the caller then uses the deterministic heuristic. */
  modelDecompose: (description: string, domains: DataDomain[]) => Promise<ModelPlan | null>;
}

// ─── The model's plan shape (UNTRUSTED — every binding re-resolved by us) ─────────────────────────
export interface ModelPlanStep {
  kind: string; // agent | connector-query | guardrail | human | output (validated)
  label?: string;
  /** For connector-query: the data phrase to bind (we re-resolve it, never trust a raw domain id). */
  dataPhrase?: string;
  /** For agent: the decision/instruction the step embodies. */
  instruction?: string;
  /** For output: the sink. */
  sink?: string;
}
export interface ModelPlan {
  title?: string;
  summary?: string;
  steps: ModelPlanStep[];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY — compileAppSpec
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function compileAppSpec(
  description: string,
  ctx: CompileCtx,
  deps: CompileDeps = defaultDeps,
): Promise<CompileResult> {
  const desc = (description ?? '').trim();
  const domains = await deps.loadDomains(ctx.orgId).catch(() => [] as DataDomain[]);

  // 1. LLM path — decompose, then re-bind + gap-check EVERY step ourselves (untrusted output).
  let assembled: { steps: AppStep[]; gaps: string[]; title: string; summary: string } | null = null;
  const plan = await deps.modelDecompose(desc, domains).catch(() => null);
  if (plan && Array.isArray(plan.steps) && plan.steps.length > 0) {
    const built = assembleFromPlan(plan, desc, domains);
    // Only accept the model plan if it produced at least one real step.
    if (built.steps.length > 0) assembled = built;
  }

  // 2. Deterministic heuristic fallback — same binding rules, no model.
  if (!assembled) assembled = heuristicDecompose(desc, domains);

  const spec = finalizeSpec(assembled, ctx, desc);

  // 3. Always return a spec that passes validateAppSpec — else report why in gaps.
  const v = validateAppSpec(spec);
  const gaps = [...assembled.gaps];
  if (!v.ok) gaps.push(...v.errors.map((e) => `Spec did not validate: ${e}`));

  return { spec, gaps };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE — assemble an AppSpec skeleton from the model's (untrusted) plan
// ─────────────────────────────────────────────────────────────────────────────────────────────
// We walk the model's ordered steps and rebuild each as a governed AppStep. Crucially:
//   • connector-query: we IGNORE any domain id the model asserts and re-resolve the dataPhrase
//     through `resolveDomain` against the DECLARED domains. Bind on a hit; gap + drop on a miss.
//   • agent / human / output: shape-checked and normalized; no fabrication possible.
export function assembleFromPlan(
  plan: ModelPlan,
  description: string,
  domains: DataDomain[],
): { steps: AppStep[]; gaps: string[]; title: string; summary: string } {
  const steps: AppStep[] = [];
  const gaps: string[] = [];
  let n = 0;

  for (const ps of plan.steps) {
    const kind = String(ps.kind ?? '').trim();
    n += 1;
    const idBase = `s${n}`;
    switch (kind) {
      case 'connector-query': {
        const phrase = (ps.dataPhrase ?? ps.label ?? '').trim();
        const bound = bindDataPhrase(phrase, domains, idBase, ps.label, gaps);
        if (bound) steps.push(bound);
        else n -= 1; // dropped (unbindable) — don't consume a step number
        break;
      }
      case 'agent':
        steps.push({
          id: idBase,
          label: ps.label?.trim() || 'Decision',
          kind: 'agent',
          inlineAgent: {
            systemPrompt:
              ps.instruction?.trim() ||
              ps.label?.trim() ||
              `Reason over the prior step results for: ${description}`,
            grounded: true,
          },
        });
        break;
      case 'human':
        steps.push({ id: idBase, label: ps.label?.trim() || 'Human review', kind: 'human' });
        break;
      case 'guardrail':
        steps.push({ id: idBase, label: ps.label?.trim() || 'Guardrail check', kind: 'guardrail' });
        break;
      case 'output':
        steps.push({
          id: idBase,
          label: ps.label?.trim() || 'Output',
          kind: 'output',
          sink: normalizeSink(ps.sink),
        });
        break;
      default:
        // Unknown kind from the model — never guess a step type into existence.
        gaps.push(`Ignored step of unknown kind '${kind}'${ps.label ? ` (${ps.label})` : ''}`);
        n -= 1;
        break;
    }
  }

  return finishAssembly(steps, gaps, plan.title, plan.summary, description);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE — deterministic heuristic decomposition (the no-gateway fallback)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Segment the description into clauses, classify each clause, and build ordered steps:
//   • a data-access clause ("read the invoice", "check the employee's quota") → connector-query
//     bound via resolveDomain (gap + drop on no declared domain — NEVER fabricate).
//   • a decision clause ("check if eligible", "decide", "approve/reject reasoning") → agent step.
//   • an approval clause ("approve", "reject", "review", "sign off") → human step.
//   • an output/notify clause ("send", "notify", "report", "email") → output step.
// Always ends with an output step. Mirrors compose/route.ts's fallback style (deterministic, coherent).
export function heuristicDecompose(
  description: string,
  domains: DataDomain[],
): { steps: AppStep[]; gaps: string[]; title: string; summary: string } {
  const clauses = segment(description);
  const steps: AppStep[] = [];
  const gaps: string[] = [];
  let sawHuman = false;
  let sawOutput = false;
  let n = 0;

  for (const clause of clauses) {
    const cls = classifyClause(clause);
    const idBase = `s${n + 1}`;
    if (cls === 'data') {
      const phrase = extractDataPhrase(clause);
      const bound = bindDataPhrase(phrase, domains, idBase, titleCase(phrase), gaps);
      if (bound) {
        steps.push(bound);
        n += 1;
      }
      // else: gap already recorded, step dropped
    } else if (cls === 'approval') {
      steps.push({ id: idBase, label: shortLabel(clause) || 'Review / approve', kind: 'human' });
      sawHuman = true;
      n += 1;
    } else if (cls === 'decision') {
      steps.push({
        id: idBase,
        label: shortLabel(clause) || 'Decision',
        kind: 'agent',
        inlineAgent: { systemPrompt: clause.trim(), grounded: true },
      });
      n += 1;
    } else if (cls === 'output') {
      steps.push({ id: idBase, label: shortLabel(clause) || 'Output', kind: 'output', sink: sinkForClause(clause) });
      sawOutput = true;
      n += 1;
    }
    // cls === 'skip' → filler clause, contributes no step
  }

  // If nothing classified as a decision/agent but we have data steps, add a synthesizing agent so the
  // app actually reasons over what it read (a bare read→output isn't a "process").
  if (steps.length > 0 && !steps.some((s) => s.kind === 'agent')) {
    steps.push({
      id: `s${n + 1}`,
      label: 'Decision',
      kind: 'agent',
      inlineAgent: { systemPrompt: description.trim() || 'Reason over the collected inputs.', grounded: true },
    });
    n += 1;
  }

  // If the description implied approval but no explicit approval clause landed a human step, and there
  // IS a decision, insert a review step before output (governed processes end with a person on
  // irreversible actions — mirrors compose's "Human before Output" rule).
  if (!sawHuman && impliesApproval(description) && steps.some((s) => s.kind === 'agent')) {
    steps.push({ id: `s${n + 1}`, label: 'Review / approve', kind: 'human' });
    n += 1;
  }

  // Always end with an output sink.
  if (!sawOutput) {
    steps.push({ id: `s${n + 1}`, label: 'Output result', kind: 'output', sink: 'console' });
    n += 1;
  }

  // Degenerate: nothing at all parsed → a single inline agent over the raw description.
  if (steps.length === 0) {
    steps.push({
      id: 's1',
      label: 'Agent',
      kind: 'agent',
      inlineAgent: { systemPrompt: description.trim() || 'Assist the user.', grounded: true },
    });
  }

  return finishAssembly(steps, gaps, undefined, undefined, description);
}

// ─── shared assembly tail: derive title/summary ──────────────────────────────────────────────────
function finishAssembly(
  steps: AppStep[],
  gaps: string[],
  title: string | undefined,
  summary: string | undefined,
  description: string,
): { steps: AppStep[]; gaps: string[]; title: string; summary: string } {
  return {
    steps,
    gaps,
    title: (title ?? '').trim() || deriveTitle(description),
    summary: (summary ?? '').trim() || description.trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE — bind a data phrase to a DECLARED domain, or record a gap (never fabricate)
// ─────────────────────────────────────────────────────────────────────────────────────────────
function bindDataPhrase(
  phrase: string,
  domains: DataDomain[],
  idBase: string,
  label: string | undefined,
  gaps: string[],
): ConnectorQueryStep | null {
  const clean = (phrase ?? '').trim();
  if (!clean) return null;
  const domain = resolveDomain(clean, domains);
  if (!domain) {
    gaps.push(`No data source declared for "${clean}" — add a data-domain mapping to wire this step.`);
    return null;
  }
  return {
    id: idBase,
    label: label?.trim() || `Read ${domain.label}`,
    kind: 'connector-query',
    domain: domain.id,
    op: 'read',
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE — finalize: linear-chain the ordered steps into a valid one-entry graph
// ─────────────────────────────────────────────────────────────────────────────────────────────
export function finalizeSpec(
  assembled: { steps: AppStep[]; gaps: string[]; title: string; summary: string },
  ctx: CompileCtx,
  description: string,
): AppSpec {
  // Guarantee a terminal output sink for EVERY compile path (LLM plan + heuristic): a governed app
  // always ends by emitting its result. The heuristic already appends one; the model-plan path may
  // not — so centralize the guarantee here. Also guarantees ≥1 step so an empty description still
  // yields a valid (output-only) spec.
  const steps = [...assembled.steps];
  const last = steps[steps.length - 1];
  if (!last || last.kind !== 'output') {
    const usedIds = new Set(steps.map((s) => s.id));
    let outId = `s${steps.length + 1}`;
    while (usedIds.has(outId)) outId += 'x';
    steps.push({ id: outId, label: 'Output', kind: 'output', sink: 'console' });
  }
  const edges: AppEdge[] =
    steps.length > 1 ? steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id })) : [];

  return {
    id: '',
    orgId: ctx.orgId,
    ownerId: ctx.ownerId,
    title: assembled.title || deriveTitle(description),
    summary: assembled.summary || description.trim(),
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps,
    edges,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE — text heuristics (segmentation + clause classification)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Split into clauses on sentence/step delimiters: commas, "then", "and then", "next", semicolons,
// arrows, numbered steps, newlines. Also strip a leading title prefix like "reimbursement approval —".
function segment(description: string): string[] {
  let d = (description ?? '').trim();
  // Drop a leading "title — rest" / "title: rest" prefix (the em-dash / colon title form).
  const dash = d.match(/^[^—:\n]{3,60}?\s*[—:-]\s+(.*)$/s);
  if (dash && /\b(read|check|approve|reject|then|decide|verify|send|notify|review)\b/i.test(dash[1])) {
    d = dash[1].trim();
  }
  return d
    .split(/(?:\bthen\b|\bnext\b|\band then\b|->|→|[;,\n]|(?:\d+\.\s))/gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type ClauseClass = 'data' | 'decision' | 'approval' | 'output' | 'skip';

const DATA_VERBS = /\b(read|check|look ?up|fetch|pull|get|retrieve|load|find|query|verify)\b/i;
const DATA_NOUNS = /\b(invoice|quota|balance|record|document|receipt|limit|history|transaction|account|order|policy|claim|ticket|customer|employee)s?\b/i;
const DECISION = /\b(decide|determine|evaluate|assess|eligib|exceed|compare|calculate|reason|classif|score|flag|check if|check whether)\b/i;
const APPROVAL = /\b(approve|reject|sign ?off|authoriz|human review|manual review|escalat|confirm)\b/i;
const OUTPUT = /\b(send|notify|email|report|output|write|post|deliver|respond|reply|export|generate a)\b/i;

function classifyClause(clause: string): ClauseClass {
  const c = clause.toLowerCase();
  // Approval takes precedence — an "approve/reject" clause is a human gate even if it mentions a noun.
  if (APPROVAL.test(c)) return 'approval';
  if (DECISION.test(c)) return 'decision';
  // A data clause = a fetch verb + a data noun.
  if (DATA_VERBS.test(c) && DATA_NOUNS.test(c)) return 'data';
  if (OUTPUT.test(c)) return 'output';
  // A bare data noun with a determiner still reads as a fetch ("the employee's quota").
  if (DATA_NOUNS.test(c) && /\b(the|their|his|her|its|employee'?s?)\b/.test(c)) return 'data';
  return 'skip';
}

// Pull the bindable phrase out of a data clause: drop the leading verb + articles, keep the noun
// phrase ("check the employee's quota" → "employee quota"; "read the invoice" → "invoice").
function extractDataPhrase(clause: string): string {
  return clause
    .toLowerCase()
    .replace(DATA_VERBS, ' ')
    .replace(/\b(the|a|an|their|his|her|its|please|and|are|is|has|have|they|ve)\b/gi, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function impliesApproval(description: string): boolean {
  return APPROVAL.test(description) || /\bapproval\b/i.test(description);
}

function sinkForClause(clause: string): 'console' | 'report' | 'email' | 'whatsapp' {
  const c = clause.toLowerCase();
  if (/\bemail\b/.test(c)) return 'email';
  if (/\bwhatsapp\b/.test(c)) return 'whatsapp';
  if (/\breport\b/.test(c)) return 'report';
  return 'console';
}

function normalizeSink(sink: string | undefined): 'console' | 'report' | 'email' | 'whatsapp' {
  const s = String(sink ?? '').toLowerCase();
  return s === 'report' || s === 'email' || s === 'whatsapp' ? s : 'console';
}

function shortLabel(clause: string): string {
  const words = clause.trim().split(/\s+/).slice(0, 6).join(' ');
  return titleCase(words);
}

function titleCase(s: string): string {
  const t = (s ?? '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Derive an app title from the description: the leading title prefix if present, else the first few words.
function deriveTitle(description: string): string {
  const d = (description ?? '').trim();
  if (!d) return 'Untitled app';
  const dash = d.match(/^([^—:\n]{3,60}?)\s*[—:-]\s+/);
  if (dash) return titleCase(dash[1].trim());
  const words = d.split(/\s+/).slice(0, 6).join(' ');
  return titleCase(words) || 'Untitled app';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DEFAULT DEPS — real gateway + org-context (mirrors compose/route.ts's modelPlan pattern)
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const defaultDeps: CompileDeps = {
  loadDomains: async (orgId: string) => {
    // Pull the org's declared domains through the org-context assembler, then map its loose
    // OrgDataDomain shape into the resolver's DataDomain. Only domains with a real connector binding
    // are usable — a domain missing a connectorId can't ground a connector-query.
    const ctx = await getOrgContext(orgId);
    const domains: DataDomain[] = [];
    for (const d of ctx.dataDomains) {
      if (!d.connectorId || !d.resource) continue;
      domains.push({
        id: d.id,
        orgId,
        label: d.label,
        aliases: d.aliases ?? [],
        connectorId: d.connectorId,
        resource: d.resource,
      });
    }
    return domains;
  },
  modelDecompose: (description, domains) => gatewayDecompose(description, domains),
};

// Ask the local gateway to decompose the description. Constrains the model to ONLY the declared
// domain labels/aliases; we still re-resolve every returned phrase. Returns null on any failure/junk
// so the caller falls back to the deterministic heuristic — the compiler always yields a spec.
async function gatewayDecompose(description: string, domains: DataDomain[]): Promise<ModelPlan | null> {
  const domainList =
    domains.length > 0
      ? domains.map((d) => `- ${d.label}${d.aliases?.length ? ` (aka: ${d.aliases.join(', ')})` : ''}`).join('\n')
      : '(none declared)';

  const sys =
    'You decompose a described business process into an ordered list of workflow steps for a ' +
    'governed AI app. Step kinds: ' +
    '"connector-query" (read data from a declared source — set dataPhrase to the data being read), ' +
    '"agent" (reason/decide — set instruction), ' +
    '"guardrail" (a governance check), ' +
    '"human" (a person must review/approve/reject), ' +
    '"output" (emit the result — set sink to console|report|email|whatsapp). ' +
    'Rules: a data-access phrase becomes connector-query; a decision/eligibility phrase becomes ' +
    'agent; an approve/reject/review phrase becomes human; always finish with one output. ' +
    'For connector-query, dataPhrase MUST be one of the DECLARED data sources below (by label or ' +
    'alias) — if the process needs data that is NOT declared, STILL emit the connector-query with ' +
    'the phrase (the system reports it as a gap); never invent a source. ' +
    'Respond with ONLY minified JSON: ' +
    '{"title":"","summary":"","steps":[{"kind":"","label":"","dataPhrase":"","instruction":"","sink":""}]}.';

  try {
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Process: ${description}\n\nDeclared data sources:\n${domainList}` },
        ],
        max_tokens: 900,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as ModelPlan;
    if (!Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null; // gateway unavailable / timeout / junk → deterministic fallback
  }
}

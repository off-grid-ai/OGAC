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

// The intermediate a decompose pass produces, before finalizeSpec turns it into an AppSpec. `edges`
// is OPTIONAL: a linear decompose leaves it undefined (finalizeSpec chains the steps in order); a
// BRANCHING decompose provides explicit guarded edges (finalizeSpec uses them verbatim).
export interface Assembled {
  steps: AppStep[];
  gaps: string[];
  title: string;
  summary: string;
  edges?: AppEdge[];
}

export interface CompileCtx {
  orgId: string;
  ownerId: string;
  /** Resolver-approved data refs for generated bindings. Omitted only by pure/unit callers. */
  allowedDataDomainIds?: ReadonlySet<string>;
  /** A resolver-approved pipeline that the generated App binds explicitly. */
  defaultPipelineId?: string | null;
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
  const loadedDomains = await deps.loadDomains(ctx.orgId).catch(() => [] as DataDomain[]);
  const allowedDataDomainIds = ctx.allowedDataDomainIds;
  const domains = allowedDataDomainIds
    ? loadedDomains.filter((domain) => allowedDataDomainIds.has(domain.id))
    : loadedDomains;

  // 1. LLM path — decompose, then re-bind + gap-check EVERY step ourselves (untrusted output).
  let assembled: Assembled | null = null;
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
): Assembled {
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
): Assembled {
  // Branching: a plain-language conditional ("if X, A, else B") compiles to a real BRANCH (decision
  // agent + guarded edges), not a linear chain. Detected first; a non-conditional description takes
  // the linear path below unchanged.
  const cond = detectConditional(description);
  if (cond) return heuristicBranchDecompose(description, cond, domains);

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
): Assembled {
  return {
    steps,
    gaps,
    title: (title ?? '').trim() || deriveTitle(description),
    summary: (summary ?? '').trim() || description.trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE — decompose a CONDITIONAL description into a BRANCHED graph (the no-gateway heuristic path):
//   [data lead-in]  →  decision agent  →  { then-branch (YES), else-branch (NO) }  →  merge → output
// The lead-in is the data reads named BEFORE the "if"; the branch comes from buildConditionalBranch;
// every non-output branch leaf merges into ONE terminal output so each path ends at an emit.
// ─────────────────────────────────────────────────────────────────────────────────────────────
function heuristicBranchDecompose(
  description: string,
  cond: ConditionalClause,
  domains: DataDomain[],
): Assembled {
  const gaps: string[] = [];
  const steps: AppStep[] = [];
  const edges: AppEdge[] = [];
  let n = 0;

  // Lead-in: data reads mentioned before the conditional ("read the claim, if amount > 1L …").
  const ifAt = description.search(/\bif\b/i);
  for (const clause of segment(ifAt > 0 ? description.slice(0, ifAt) : '')) {
    if (classifyClause(clause) !== 'data') continue;
    const phrase = extractDataPhrase(clause);
    const bound = bindDataPhrase(phrase, domains, `s${n + 1}`, titleCase(phrase), gaps);
    if (bound) {
      steps.push(bound);
      n += 1;
    }
  }
  const leadLast = steps.at(-1)?.id;

  // The branch (decision + guarded branches); ids continue after the lead-in.
  const br = buildConditionalBranch(cond, n + 1);
  const decisionId = br.steps[0].id;
  steps.push(...br.steps);
  n += br.steps.length;
  if (leadLast) edges.push({ from: leadLast, to: decisionId });
  edges.push(...br.edges);

  // Merge every non-output branch leaf into one terminal output (a leaf already an output is itself
  // terminal). Guarantees ≥1 output + that every path ends at an emit.
  const kindOf = (id: string): string | undefined => steps.find((s) => s.id === id)?.kind;
  const danglers = br.leaves.filter((id) => kindOf(id) !== 'output');
  if (danglers.length > 0) {
    const outId = `s${n + 1}`;
    steps.push({ id: outId, label: 'Output result', kind: 'output', sink: 'console' });
    for (const id of danglers) edges.push({ from: id, to: outId });
  }

  return { steps, gaps, edges, title: deriveTitle(description), summary: description.trim() };
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
  assembled: Assembled,
  ctx: CompileCtx,
  description: string,
): AppSpec {
  const base = {
    id: '',
    orgId: ctx.orgId,
    ownerId: ctx.ownerId,
    title: assembled.title || deriveTitle(description),
    summary: assembled.summary || description.trim(),
    visibility: 'private' as const,
    published: false,
    ...(ctx.defaultPipelineId ? { pipelineId: ctx.defaultPipelineId } : {}),
    trigger: { kind: 'on-demand' as const },
  };

  // BRANCH path: a decompose that authored explicit (guarded) edges — use them VERBATIM. The branch
  // decompose already guarantees a terminal output on every path, so we do not re-chain or append.
  if (assembled.edges && assembled.edges.length > 0) {
    return { ...base, steps: assembled.steps, edges: assembled.edges };
  }

  // LINEAR path (unchanged): guarantee a terminal output sink for EVERY compile path (a governed app
  // always ends by emitting its result), then chain the ordered steps into a one-entry graph. Also
  // guarantees ≥1 step so an empty description still yields a valid (output-only) spec.
  const steps = [...assembled.steps];
  const last = steps.at(-1);
  if (last?.kind !== 'output') {
    const usedIds = new Set(steps.map((s) => s.id));
    let outId = `s${steps.length + 1}`;
    while (usedIds.has(outId)) outId += 'x';
    steps.push({ id: outId, label: 'Output', kind: 'output', sink: 'console' });
  }
  const edges: AppEdge[] =
    steps.length > 1 ? steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id })) : [];

  return { ...base, steps, edges };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE — text heuristics (segmentation + clause classification)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Split into clauses on sentence/step delimiters: commas, "then", "and then", "next", semicolons,
// arrows, numbered steps, newlines. Also strip a leading title prefix like "reimbursement approval —".
function segment(description: string): string[] {
  let d = (description ?? '').trim();
  // Drop a leading "title — rest" / "title: rest" prefix (the em-dash / colon title form).
  const dash = /^[^—:\n]{3,60}?\s*[—:-]\s+(.*)$/s.exec(d);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PURE — conditional (branching) recognition + build. "if X, A, (else|otherwise) B" → a decision
// agent + two guarded branches. The runner (app-run-plan.planAdvance) honors the guards; here we
// only AUTHOR them from plain language so the non-tech persona gets a real branch, not a linear
// approximation. The decision agent is instructed to answer YES/NO and the branch edges guard on
// that token — a deterministic, model-friendly contract (no free-form expression language).
// ─────────────────────────────────────────────────────────────────────────────────────────────
export interface ConditionalClause {
  condition: string;
  thenText: string;
  elseText: string | null;
}

// Parse "if <condition>[,] [then] <then>, (else|otherwise) <else>". Robust, multi-step (not one
// brittle regex): peel off if → else → then/comma, so real phrasings survive
// ("if the claim is over 1 lakh, route to a surveyor, otherwise auto-approve").
//
// HONESTY / no over-interpretation: a genuine two-way branch REQUIRES an explicit else/otherwise.
// An "if-only" phrase like "check if they are eligible, then approve" is linguistically ambiguous
// with a plain decision-then-action ("decide eligibility, then approve") — so we do NOT invent a
// branch from it (that returns null, and the linear decompose handles it as a decision + action).
// Returns null when there is no `if`, no `else`, or the condition and then-action can't be split.
export function detectConditional(text: string): ConditionalClause | null {
  const ifm = /\bif\b\s+(.+)/is.exec((text ?? '').trim());
  if (!ifm) return null;
  const em = /\b(?:else|otherwise)\b\s+(.+)$/is.exec(ifm[1]);
  if (!em) return null; // no else ⇒ not a two-way branch (don't over-interpret a decision phrase)
  const elseText = em[1].trim().replace(/[.,;\s]+$/, '');
  const rest = ifm[1].slice(0, em.index).trim();
  if (!elseText) return null;

  let condition: string;
  let thenText: string;
  const tm = /^(.+?)[,;]?\s+then\s+(.+)$/is.exec(rest);
  if (tm) {
    condition = tm[1];
    thenText = tm[2];
  } else {
    const ci = rest.indexOf(',');
    if (ci < 0) return null; // no "then" and no comma ⇒ can't split condition from action
    condition = rest.slice(0, ci);
    thenText = rest.slice(ci + 1);
  }
  condition = condition.trim().replace(/[,;.]+$/, '');
  thenText = thenText.trim().replace(/[,;.]+$/, '');
  if (!condition || !thenText) return null;
  return { condition, thenText, elseText };
}

// Build one branch clause into a step (output/human/agent) — the branch tail the merge wires to.
function branchStep(clause: string, id: string): AppStep {
  const cls = classifyClause(clause);
  if (cls === 'output') {
    return { id, label: shortLabel(clause) || 'Output', kind: 'output', sink: sinkForClause(clause) };
  }
  if (cls === 'approval') return { id, label: shortLabel(clause) || 'Review / approve', kind: 'human' };
  return {
    id,
    label: shortLabel(clause) || 'Action',
    kind: 'agent',
    inlineAgent: { systemPrompt: clause.trim(), grounded: true },
  };
}

// Assemble the decision agent + guarded branches from a parsed conditional. Step ids start at
// `s${startN}`. Returns the branch steps, the guarded edges (decision → branch), and the `leaves`
// (branch tail ids) the caller merges into the terminal output step.
export function buildConditionalBranch(
  cond: ConditionalClause,
  startN: number,
): { steps: AppStep[]; edges: AppEdge[]; leaves: string[] } {
  const dId = `s${startN}`;
  const steps: AppStep[] = [
    {
      id: dId,
      label: shortLabel(cond.condition) || 'Decision',
      kind: 'agent',
      inlineAgent: {
        systemPrompt: `Decide whether: ${cond.condition}. Answer with exactly one word: YES or NO.`,
        grounded: true,
      },
    },
  ];
  const edges: AppEdge[] = [];
  const leaves: string[] = [];

  const thenId = `s${startN + 1}`;
  steps.push(branchStep(cond.thenText, thenId));
  edges.push({ from: dId, to: thenId, when: `${dId} contains "yes"` });
  leaves.push(thenId);

  if (cond.elseText) {
    const elseId = `s${startN + 2}`;
    steps.push(branchStep(cond.elseText, elseId));
    edges.push({ from: dId, to: elseId, when: `${dId} contains "no"` });
    leaves.push(elseId);
  }
  return { steps, edges, leaves };
}

export type OutputSinkKind = 'console' | 'report' | 'email' | 'whatsapp' | 'webhook' | 'slack';

export interface InferredOutputSink {
  sink: OutputSinkKind;
  /** Recipient config the phrasing revealed (to / channel / url), when present. */
  config?: Record<string, unknown>;
  /** An honest gap when a delivery sink is chosen but the recipient isn't specified. */
  gap?: string;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const URL_RE = /(https?:\/\/[^\s"')]+)/i;
const SLACK_CHANNEL_RE = /#[\w-]+/;

/**
 * Map plain-language DELIVERY intent → the right governed output sink (+ recipient + honest gap). PURE.
 * A non-technical author who says "post to Slack" / "send a webhook" / "email finance" gets the real
 * channel, not a silent `console` sink. Recipients are extracted only when literally present — never
 * fabricated; a delivery sink without a recipient reports a gap the author fixes before publishing.
 * Order = most-specific first (webhook + URL before a generic "send").
 */
export function inferOutputSink(text: string): InferredOutputSink {
  const c = (text ?? '').toLowerCase();
  const raw = text ?? '';
  if (/\bwebhook\b/.test(c) || (/\b(post|send|call)\b/.test(c) && URL_RE.test(raw))) {
    const url = raw.match(URL_RE)?.[1];
    return url
      ? { sink: 'webhook', config: { url } }
      : { sink: 'webhook', gap: 'Webhook delivery: no destination URL found — set the webhook URL before publishing.' };
  }
  if (/\bslack\b/.test(c)) {
    const channel = raw.match(SLACK_CHANNEL_RE)?.[0];
    return {
      sink: 'slack',
      ...(channel ? { config: { channel } } : {}),
      gap: 'Slack delivery needs the incoming-webhook URL configured in Messaging → Slack before it can post.',
    };
  }
  if (/\bwhatsapp\b/.test(c)) {
    const to = raw.match(/\+?\d[\d\s-]{7,}\d/)?.[0]?.replace(/[\s-]/g, '');
    return to
      ? { sink: 'whatsapp', config: { to } }
      : { sink: 'whatsapp', gap: 'WhatsApp delivery: no recipient number found — set it before publishing.' };
  }
  if (/\b(e-?mail)\b/.test(c)) {
    const to = raw.match(EMAIL_RE)?.[0];
    return to
      ? { sink: 'email', config: { to } }
      : { sink: 'email', gap: 'Email delivery: no recipient address found — set the "to" address before publishing.' };
  }
  if (/\b(report|pdf)\b/.test(c)) return { sink: 'report' };
  return { sink: 'console' };
}

function sinkForClause(clause: string): OutputSinkKind {
  return inferOutputSink(clause).sink;
}

function normalizeSink(sink: string | undefined): OutputSinkKind {
  const s = String(sink ?? '').toLowerCase();
  return s === 'report' || s === 'email' || s === 'whatsapp' || s === 'webhook' || s === 'slack'
    ? (s as OutputSinkKind)
    : 'console';
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
  const dash = /^([^—:\n]{3,60}?)\s*[—:-]\s+/.exec(d);
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
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as ModelPlan;
    if (!Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null; // gateway unavailable / timeout / junk → deterministic fallback
  }
}

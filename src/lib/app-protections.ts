// ─── "What protects this app?" ────────────────────────────────────────────────────────────────────────
//
// The guardrail, masking and routing capabilities are real and enforced, and the only places they were
// legible were operator surfaces in operator language — `/governance/guardrails/*`,
// `/runtime/models/routing`, the pipeline's policy overlay. The department that USES the app, and the
// non-technical person who owns it, could not answer "what is protecting this?" anywhere.
//
// Everything here comes from the app's own pipeline: its guardrail overlay, its policy overlay, its
// routing rules and its data allowlist.
//
// ── THE HONESTY LINE THAT MATTERS ──
// These are the RULES IN FORCE, not evidence of what happened on any particular run. `WHATS_MISSING_2.md`
// established that the ledger records a model name and nothing about where that model ran — no provider,
// no host, no region, no per-run egress event. So a routing rule saying "personal data stays local" is a
// commitment the platform is configured to keep, and this module says exactly that. Presenting it as
// "nothing left your building" would dress configuration up as proof, which is the one thing a
// governance surface must never do.
//
// Pure. Zero IO.

export interface RoutingRule {
  name?: string;
  attribute?: string;
  operator?: string;
  value?: string;
  action?: string;
  enabled?: boolean;
}

export interface ProtectionsInput {
  /** The pipeline's guardrail overlay, e.g. { requirePiiMasking: { bool: true, mode: 'locked' } }. */
  guardrailOverlay?: Record<string, { bool?: boolean; mode?: string }> | null;
  /** The pipeline's policy overlay, e.g. { requireApprovalOverInr: { mode: 'locked' } }. */
  policyOverlay?: Record<string, { mode?: string; level?: string }> | null;
  routingRules?: readonly RoutingRule[] | null;
  /** Domain/source ids this app may read. */
  dataAllowlist?: readonly string[] | null;
  /** Whether any step pauses for a person. */
  hasHumanStep?: boolean;
}

export interface Protection {
  /** Plain language, outcome-first. Never the name of a mechanism. */
  title: string;
  /** The consequence, or the limit of the claim. */
  detail: string;
  /** True when this cannot be turned off for this app — worth saying, it is the strongest form. */
  locked: boolean;
}

/** Human wording for the overlay keys we know about. Unknown keys are skipped, never guessed at. */
const GUARDRAIL_COPY: Record<string, { title: string; detail: string }> = {
  requirePiiMasking: {
    title: 'Personal details are hidden before the AI sees them',
    detail:
      'Names, numbers and identifiers are replaced with stand-ins on the way in, and the same real value always maps to the same stand-in, so the work still joins up.',
  },
};

const POLICY_COPY: Record<string, { title: string; detail: string }> = {
  requireApprovalOverInr: {
    title: 'Large amounts need a person to approve them',
    detail: 'Above the limit set for this process, the app cannot decide on its own.',
  },
};

/**
 * What is protecting this app, in the words of someone who does not work in IT.
 *
 * Only rules that are actually ENABLED are listed. A disabled rule is not a protection, and listing it
 * greyed-out would let a reader come away believing they had something they do not.
 */
export function describeProtections(input: ProtectionsInput): Protection[] {
  const out: Protection[] = [];

  for (const [key, v] of Object.entries(input.guardrailOverlay ?? {})) {
    if (v?.bool !== true) continue;
    const copy = GUARDRAIL_COPY[key];
    if (!copy) continue;
    out.push({ ...copy, locked: v.mode === 'locked' });
  }

  for (const [key, v] of Object.entries(input.policyOverlay ?? {})) {
    const copy = POLICY_COPY[key];
    if (!copy) continue;
    out.push({ ...copy, locked: v?.mode === 'locked' });
  }

  for (const r of input.routingRules ?? []) {
    if (r.enabled === false) continue;
    const p = describeRoutingRule(r);
    if (p) out.push(p);
  }

  if (input.hasHumanStep) {
    out.push({
      title: 'A person decides, not the app',
      detail: 'Every case stops for someone to approve or reject it before anything is acted on.',
      locked: false,
    });
  }

  const allow = input.dataAllowlist ?? [];
  if (allow.length > 0) {
    out.push({
      title: `This app can only read ${allow.length} approved ${allow.length === 1 ? 'source' : 'sources'}`,
      detail: 'It cannot reach anything else in the organisation, even if asked to.',
      locked: false,
    });
  }

  return out;
}

/**
 * One routing rule as a protection, or null when it is not one.
 *
 * Only the rules whose EFFECT a department reader would care about are translated. A rule we cannot state
 * plainly is left out rather than paraphrased into something that sounds like a guarantee.
 */
function describeRoutingRule(r: RoutingRule): Protection | null {
  const attribute = (r.attribute ?? '').toLowerCase();
  const value = (r.value ?? '').toLowerCase();
  const action = (r.action ?? '').toLowerCase();

  if (attribute === 'data_class' && value === 'pii' && action === 'local') {
    return {
      title: 'Anything with personal data is handled on your own hardware',
      // The limit of the claim, stated in the claim. This is the rule in force, not a per-run receipt.
      detail:
        'Work carrying personal data is routed to the models running in your building, so it is not sent to an outside provider. This is the rule the platform enforces for this app.',
      locked: false,
    };
  }
  if (attribute === 'data_class' && value === 'restricted' && action === 'block') {
    return {
      title: 'The most sensitive data is refused outright',
      detail: 'Anything classified as restricted is not processed by this app at all.',
      locked: false,
    };
  }
  if (action === 'block') {
    return {
      title: `Work marked "${r.value}" is refused`,
      detail: 'This app will not process it.',
      locked: false,
    };
  }
  return null;
}

// ─── What this app reads ─────────────────────────────────────────────────────────────────────────────
//
// The knowledge and data-source capabilities were reachable only THROUGH the app's individual steps — a
// reader had to open the Build editor and interpret step definitions to learn what the app looks at. The
// protections panel could say "it can only read 6 approved sources" without ever naming one, which is
// reassurance without information.
//
// Pure.

export interface StepLike {
  kind: string;
  /** A connector-query step's declared domain — an id or a label. */
  domain?: string;
}

export interface DomainLabel {
  id: string;
  label: string;
}

/**
 * The named things this app reads, in the order its steps read them, de-duplicated.
 *
 * A domain reference that resolves to nothing is DROPPED rather than shown as a raw id: "reads
 * dom_7d17b157-0e6" tells a department reader less than saying nothing, and it was exactly the defect
 * fixed once already on the case picker. The count of unresolved ones is returned so a caller can be
 * honest that the list is partial instead of quietly presenting it as complete.
 */
export function describeReads(
  steps: readonly StepLike[],
  domains: readonly DomainLabel[],
): { names: string[]; unresolved: number } {
  const byId = new Map(domains.map((d) => [d.id, d.label]));
  const byLabel = new Map(domains.map((d) => [d.label.toLowerCase(), d.label]));
  const names: string[] = [];
  const seen = new Set<string>();
  let unresolved = 0;

  for (const st of steps) {
    if (st.kind !== 'connector-query') continue;
    const ref = (st.domain ?? '').trim();
    if (!ref) continue;
    const label = byId.get(ref) ?? byLabel.get(ref.toLowerCase()) ?? null;
    if (!label) {
      unresolved++;
      continue;
    }
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(label);
  }
  return { names, unresolved };
}

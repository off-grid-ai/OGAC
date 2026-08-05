// ─── GUIDE COPILOT — the question → destination decision, PURE (zero I/O) ─────────────────────────
//
// WHY THIS EXISTS
// Public demo links go to investors, angels and founders on read-only `viewer` accounts. They open
// the console ALONE, with nobody presenting, and today they have to guess what to click. The
// 2026-08-05 viewer audit's first section is blunt about the cost of that: the good screens are real,
// but a stranger has no route to them. This module is the map — it turns a buyer's question ("show me
// proof our data never leaves our network") into a real destination in the product.
//
// WHY IT IS PURE
// The answer half is already I/O (POST /api/v1/admin/copilot → the on-prem model over live records).
// The NAVIGATION half must not be: a destination that 404s or lands on an empty screen is worse than
// no copilot at all, so "given a question, which route?" has to be assertable in a unit test. Keeping
// it a pure function is what lets `test/guide-copilot.test.ts` walk the real Next.js app router and
// prove EVERY href in the table below is a route that exists.
//
// WHY DESTINATIONS ARE TENANT-SCOPED
// Live finding, 2026-08-05: `/operations/runs/agent%3Arun_0d632888` is a 10-step governed trace on
// the INSURER tenant. Requesting the same URL as the bank demo viewer returns HTTP 200 with an EMPTY
// body — the org scoping works (good, no cross-tenant leak) but a hardcoded id would have been a dead
// destination on the other tenant. So an entity-anchored destination declares which tenants it holds
// for, and every question also carries a tenant-neutral list route as a fallback.
//
// WHY THE COPY READS THE WAY IT DOES
// Outcomes, not features, spoken to "you" (the repo's copy rule). "Show me proof this never left our
// network" beats "View the egress policy engine". And nothing here may name an OSS engine, a private
// host, a port or an env var — a visitor reads these strings.

import { matchFeatures } from './search-features';

// ─── Types ───────────────────────────────────────────────────────────────────────────────────────

export type GuideThemeId = 'private' | 'works' | 'trust' | 'value';

export interface GuideTheme {
  id: GuideThemeId;
  /** The question a buyer is really asking, in their words. */
  label: string;
}

export interface GuideDestination {
  /** The "take me there" button label — where you are going, in outcome language. */
  label: string;
  /** A route that EXISTS. Asserted against the real app router by the unit test. */
  href: string;
  /** What you will see when you land. Sets an honest expectation before the click. */
  what: string;
  /**
   * Tenant slugs this destination holds for. Absent = every tenant (a list/overview route).
   * Present = anchored to a seeded entity that only exists on those tenants.
   */
  tenants?: readonly string[];
}

export interface GuideQuestion {
  id: string;
  theme: GuideThemeId;
  /** Asked the way a buyer would ask it. */
  question: string;
  /** Extra match terms for free text; the question's own words already match. */
  keywords: readonly string[];
  /** Best destination first. */
  destinations: readonly GuideDestination[];
}

/** How a resolution was reached — surfaced so the widget can be honest about a weak match. */
export type GuideMatch = 'starter' | 'topic' | 'index' | 'none';

export interface GuideResolution {
  destinations: GuideDestination[];
  match: GuideMatch;
}

// ─── Tenant slugs of the live demo tenants ───────────────────────────────────────────────────────
// From `tenantSlugFromHost` — "<slug>-onprem-console.<apex>".
const INSURER = 'suraksha';
const BANK = 'bharatunion';

// ─── Destinations, each verified live on 2026-08-05 as this demo viewer ──────────────────────────
//
// The evidence behind each one is recorded next to it, because "is this screen still strong?" is a
// claim about the past that rots — a later session needs to know what was checked, not just that
// something was.

/** Tenant-neutral: the unified run list. Populated on both tenants (66 insurer / 118 bank agent runs). */
const RUNS_LIST: GuideDestination = {
  label: 'See every run',
  href: '/operations/runs',
  what: 'Every app, agent and chat execution, newest first — open any one for its full step-by-step trace.',
};

/**
 * The single best piece of evidence in the product: one governed run's whole timeline —
 * permission check → guardrails → retrieval → sensitive-data masking → the model → grounding
 * check → signature.
 *
 * insurer `run_0d632888`: 11 steps, "Renewal & Persistency Nudge · Recommend a retention action".
 * bank `run_b922bd7b`: 10 steps, 80% of claims grounded, no warnings, answer signed.
 */
const FEATURED_TRACE: readonly GuideDestination[] = [
  {
    label: 'Open a real governed run',
    href: '/operations/runs/agent%3Arun_0d632888',
    what: 'Eleven steps on one piece of real work: the permission check, the guardrails, where the facts came from, what got masked, the model, and the signature on the answer.',
    tenants: [INSURER],
  },
  {
    label: 'Open a real governed run',
    href: '/operations/runs/agent%3Arun_b922bd7b',
    what: 'Ten steps on one piece of real work: the permission check, the guardrails, where the facts came from, what got masked, the model, and the signature on the answer.',
    tenants: [BANK],
  },
  RUNS_LIST,
];

/**
 * A run whose answer was checked against its sources and passed — the anti-hallucination proof.
 * insurer `run_0345c0ac` "Death-Claim Assessment · Assess claim risk", 100% of claims grounded.
 * bank `run_b34b1702` "Reimbursement Approval · Decide eligibility", 100% of claims grounded.
 */
const GROUNDED_TRACE: readonly GuideDestination[] = [
  {
    label: 'See an answer checked against its sources',
    href: '/operations/runs/agent%3Arun_0345c0ac',
    what: 'A claim-risk assessment where every statement in the answer was traced back to a source document before anyone saw it.',
    tenants: [INSURER],
  },
  {
    label: 'See an answer checked against its sources',
    href: '/operations/runs/agent%3Arun_b34b1702',
    what: 'An eligibility decision where every statement in the answer was traced back to a source document before anyone saw it.',
    tenants: [BANK],
  },
];

export const GUIDE_THEMES: readonly GuideTheme[] = [
  { id: 'private', label: 'Is it private?' },
  { id: 'works', label: 'Does it actually work?' },
  { id: 'trust', label: 'Can I trust it?' },
  { id: 'value', label: 'Is it worth it?' },
];

export const GUIDE_QUESTIONS: readonly GuideQuestion[] = [
  // ── Is it private? ───────────────────────────────────────────────────────────────────────────
  {
    id: 'never-left-network',
    theme: 'private',
    question: 'Show me proof our data never leaves our network.',
    keywords: [
      'leave',
      'leaves',
      'egress',
      'network',
      'on prem',
      'on-prem',
      'onprem',
      'private',
      'cloud provider',
      'outside model',
      'data residency',
      'residency',
      'sovereign',
      'air gap',
    ],
    destinations: [
      {
        label: 'See what can and cannot leave',
        href: '/governance/egress',
        what: 'On-prem requests never leave the box. If one is routed to an outside model, names, PAN, Aadhaar, card numbers and emails are stripped first — and if that screening cannot run, the call is refused rather than sent unprotected.',
      },
      {
        label: 'See the controls that apply everywhere',
        href: '/governance/posture',
        what: 'The controls you set once and every app, model request and data flow inherits — with the current state of each one in plain words.',
      },
    ],
  },
  {
    id: 'pii-in-a-prompt',
    theme: 'private',
    question: "What happens if someone types a customer's PAN or Aadhaar into a prompt?",
    keywords: [
      'pan',
      'aadhaar',
      'pii',
      'personal data',
      'customer data',
      'sensitive',
      'mask',
      'masking',
      'redact',
      'anonymise',
      'anonymize',
      'gdpr',
      'dpdp',
    ],
    destinations: [
      {
        label: 'See the protections that are on',
        href: '/governance/guardrails',
        what: 'The checks that run on every request and every answer — what they look for, and what they do when they find it.',
      },
      ...FEATURED_TRACE.filter((d) => d !== RUNS_LIST),
    ],
  },
  {
    id: 'where-facts-came-from',
    theme: 'private',
    question: 'Where does our data live, and where did each answer get its facts?',
    keywords: [
      'lineage',
      'where did',
      'data flow',
      'provenance',
      'source of truth',
      'which system',
      'trace data',
      'data map',
    ],
    destinations: [
      {
        label: 'Follow the data',
        href: '/data/lineage',
        what: 'Every source, every job and every dataset on one map — pick any answer and walk backwards to the systems it came from.',
      },
      {
        label: 'See the signed record for each run',
        href: '/governance/evidence/provenance',
        what: 'Every run leaves a signed, tamper-evident record. Any of them can be re-verified on demand, in front of you.',
      },
    ],
  },

  // ── Does it actually work? ───────────────────────────────────────────────────────────────────
  {
    id: 'real-work-end-to-end',
    theme: 'works',
    question: 'Show me the AI doing a real piece of our work, start to finish.',
    keywords: [
      'end to end',
      'real work',
      'demo',
      'example',
      'show me it working',
      'trace',
      'step by step',
      'what happened',
      'run',
      'how does it work',
    ],
    destinations: [...FEATURED_TRACE],
  },
  {
    id: 'waiting-for-a-person',
    theme: 'works',
    question: 'What is waiting for a person to decide right now?',
    keywords: [
      'waiting',
      'queue',
      'my tasks',
      'approve',
      'approval',
      'decide',
      'decision',
      'human in the loop',
      'review',
      'sign off',
      'inbox',
      'case',
      'cases',
    ],
    destinations: [
      {
        label: 'Open the decision queue',
        href: '/work/tasks',
        what: 'The cases the AI has prepared and handed to a person, oldest first, with the real amounts and how long each has waited.',
      },
      {
        label: 'See who is covering',
        href: '/work/tasks',
        what: 'The same queue tells you whether anyone is actually watching it while a colleague is away.',
      },
    ],
  },
  {
    id: 'what-apps-do',
    theme: 'works',
    question: 'What can these apps actually do for my team?',
    keywords: [
      'apps',
      'app',
      'what can it do',
      'use case',
      'use cases',
      'workflow',
      'workflows',
      'automation',
      'automate',
      'build',
      'department',
    ],
    destinations: [
      {
        label: 'Browse the working apps',
        href: '/solutions/apps',
        what: 'Each one does a piece of real work and was described in plain language, not coded. Your rules about data, safety and who approves what are already applied to all of them.',
      },
      {
        label: 'See a case that a person signed off',
        href: '/solutions/apps/bhapp_reimb/review',
        what: 'A reimbursement decision the AI recommended and a person approved — with the report that carries the decision out.',
        tenants: [BANK],
      },
    ],
  },

  // ── Can I trust it? ──────────────────────────────────────────────────────────────────────────
  {
    id: 'didnt-make-it-up',
    theme: 'trust',
    question: "Prove the AI didn't just make the answer up.",
    keywords: [
      'hallucinate',
      'hallucination',
      'make up',
      'made up',
      'made it up',
      'accurate',
      'accuracy',
      'grounded',
      'grounding',
      'wrong answer',
      'reliable',
      'citation',
      'citations',
    ],
    destinations: [
      ...GROUNDED_TRACE,
      {
        label: 'See the signed record for each run',
        href: '/governance/evidence/provenance',
        what: 'Every run leaves a signed, tamper-evident record. Any of them can be re-verified on demand, in front of you.',
      },
    ],
  },
  {
    id: 'who-did-what',
    theme: 'trust',
    question: 'Who did what — and could I hand that to a regulator?',
    keywords: [
      'audit',
      'audit trail',
      'log',
      'logs',
      'regulator',
      'regulatory',
      'compliance',
      'evidence',
      'irdai',
      'rbi',
      'cert-in',
      'iso',
      'eu ai act',
      'report',
      'reports',
      'who accessed',
    ],
    destinations: [
      {
        label: 'Read the audit trail',
        href: '/governance/evidence/audit',
        what: 'Every action, who took it, what it touched and how it ended — including the ones that were blocked or had data redacted. Exportable as CSV or JSON.',
      },
      {
        label: 'Get a regulator-ready pack',
        href: '/governance/trust/reports',
        what: 'Pre-built response packs for the regulators you answer to, each assembled from the evidence above rather than written by hand.',
      },
      {
        label: 'See how we score ourselves',
        href: '/governance/trust',
        what: 'Every control we claim, scored honestly against the frameworks you are held to — including the ones still in progress.',
      },
    ],
  },
  {
    id: 'stopping-a-bad-answer',
    theme: 'trust',
    question: 'What stops a bad answer from reaching a customer?',
    keywords: [
      'block',
      'blocked',
      'blocks',
      'stop',
      'stopped',
      'prevent',
      'guardrail',
      'guardrails',
      'policy',
      'policies',
      'safety',
      'deny',
      'denied',
      'refuse',
      'governance',
      'control',
      'controls',
    ],
    destinations: [
      {
        label: 'See the controls that apply everywhere',
        href: '/governance/posture',
        what: 'The controls you set once and every app, model request and data flow inherits — with the current state of each one in plain words.',
      },
      {
        label: 'See the protections that are on',
        href: '/governance/guardrails',
        what: 'The checks that run on every request and every answer — what they look for, and what they do when they find it.',
      },
      RUNS_LIST,
    ],
  },
  {
    id: 'is-this-really-running',
    theme: 'trust',
    question: 'Is this really running, or am I looking at a mock-up?',
    keywords: [
      'real',
      'really running',
      'mock',
      'mockup',
      'mock-up',
      'fake',
      'live',
      'health',
      'healthy',
      'uptime',
      'up',
      'status',
      'services',
      'service',
      'infrastructure',
    ],
    // NOT /operations/services, which would be the obvious answer. Live check 2026-08-05: that page
    // renders the name of every OSS component the platform is assembled from (nineteen of them in one
    // response). It is the right screen for an operator and the wrong one for a visitor, so the
    // liveness proof here is the run history and a signature you can re-verify on the spot instead.
    destinations: [
      RUNS_LIST,
      {
        label: 'Verify a signature yourself',
        href: '/governance/evidence/provenance',
        what: 'Fifty signed run records. Press Verify on any of them and the signature is re-checked in front of you — a mock-up cannot do that.',
      },
    ],
  },

  // ── Is it worth it? ──────────────────────────────────────────────────────────────────────────
  {
    id: 'what-is-it-saving',
    theme: 'value',
    question: 'What is this saving us, in hours and rupees?',
    keywords: [
      'roi',
      'return',
      'saving',
      'savings',
      'save',
      'saved',
      'worth',
      'value',
      'payback',
      'business case',
      'hours',
      'productivity',
      'outcome',
      'outcomes',
      'benefit',
    ],
    destinations: [
      {
        label: 'See the return',
        href: '/insights/outcomes',
        what: 'Hours and money saved per app and per department, set against what the AI actually cost — with the measured numbers separated from the estimates.',
      },
    ],
  },
  {
    id: 'what-does-it-cost',
    theme: 'value',
    question: 'What does running this actually cost?',
    keywords: [
      'cost',
      'costs',
      'spend',
      'spending',
      'price',
      'pricing',
      'budget',
      'budgets',
      'token',
      'tokens',
      'bill',
      'billing',
      'expensive',
      'chargeback',
    ],
    destinations: [
      {
        label: 'See the spend',
        href: '/insights/cost/overview',
        what: 'What was spent, on what, by whom — broken down by team and by workflow, for whatever window you pick.',
      },
      {
        label: 'See the return',
        href: '/insights/outcomes',
        what: 'The other half of the sum: hours and money saved per app and per department, against that cost.',
      },
    ],
  },
];

// ─── Read-only safety ────────────────────────────────────────────────────────────────────────────
//
// The audience CANNOT write. The viewer audit reproduced the worst version of getting this wrong: a
// quick action → a fully-armed "Add PostgreSQL" form → submit → a bare red "Failed to add connector"
// toast, three clicks from the first screen a stranger sees. The guide must never be another door
// into that, so a destination that exists only to start a write is not a destination.

const WRITE_SEGMENTS = ['new', 'create', 'add', 'edit', 'forge', 'import', 'invite', 'signup'] as const;

/**
 * True when a route is safe to offer a read-only visitor: nothing whose whole purpose is to begin a
 * write. Pure; matches on path SEGMENTS so `/data/newsroom` would not trip the `new` rule.
 */
export function isReadOnlySafeHref(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  const segments = path.split('/').filter(Boolean);
  return !segments.some((s) => (WRITE_SEGMENTS as readonly string[]).includes(s.toLowerCase()));
}

// ─── Resolution ──────────────────────────────────────────────────────────────────────────────────

/** Keep only the destinations that hold for this tenant. */
function forTenant(
  destinations: readonly GuideDestination[],
  tenantSlug: string | null | undefined,
): GuideDestination[] {
  return destinations.filter((d) => {
    if (!d.tenants) return true;
    return tenantSlug ? d.tenants.includes(tenantSlug) : false;
  });
}

/** De-duplicate by href, keeping the first (best) label for each. */
function dedupe(destinations: GuideDestination[]): GuideDestination[] {
  const seen = new Set<string>();
  return destinations.filter((d) => {
    if (seen.has(d.href)) return false;
    seen.add(d.href);
    return true;
  });
}

/**
 * The starter questions to show this tenant, with tenant-specific destinations already filtered out.
 * A question whose every destination is another tenant's is dropped rather than shown dead — there
 * is currently no such question, and the test asserts that stays true.
 */
export function guideQuestionsForTenant(tenantSlug: string | null | undefined): GuideQuestion[] {
  return GUIDE_QUESTIONS.map((q) => ({
    ...q,
    destinations: dedupe(forTenant(q.destinations, tenantSlug)).filter((d) =>
      isReadOnlySafeHref(d.href),
    ),
  })).filter((q) => q.destinations.length > 0);
}

const WORD_RE = /[a-z0-9]+/g;

/** Normalised word set of a string — the shared tokenisation both scoring paths use. */
function words(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

/**
 * Score a question against free text: how many of its terms the text contains. Multi-word keywords
 * must appear as a phrase; single words must match a whole word (so "cost" does not match
 * "costume", and — the case that actually bit — "up" does not match "upgrade").
 */
function score(question: GuideQuestion, text: string): number {
  const lower = ` ${text.toLowerCase()} `;
  const set = new Set(words(text));
  let hits = 0;
  for (const term of [...question.keywords, question.question]) {
    const t = term.toLowerCase();
    if (t.includes(' ')) {
      if (lower.includes(t)) hits += 2;
    } else if (set.has(t)) {
      hits += 1;
    }
  }
  return hits;
}

/** A starter question matched verbatim (the visitor clicked a chip rather than typing). */
function starterFor(text: string): GuideQuestion | undefined {
  const norm = words(text).join(' ');
  return GUIDE_QUESTIONS.find((q) => words(q.question).join(' ') === norm);
}

const MIN_TOPIC_SCORE = 2;

/**
 * Question → destinations. The whole point of the widget: an answer with nowhere to go is a
 * dead end, and a link to the wrong page is worse than none.
 *
 * Order of preference:
 *  1. `starter`  — the exact text of a curated question (a clicked chip). Its curated destinations.
 *  2. `topic`    — enough curated keywords hit. The best-scoring question's destinations.
 *  3. `index`    — nothing curated matched, so fall back to the SAME route index the ⌘K palette
 *                  uses (`matchFeatures`), filtered to read-only-safe routes. One index, not two.
 *  4. `none`     — honestly nothing. The widget then says so and shows the starter questions;
 *                  it does NOT guess a page.
 */
export function resolveGuideDestinations(
  question: string,
  options: { tenantSlug?: string | null; sanitize?: (label: string) => string } = {},
): GuideResolution {
  const text = question.trim();
  if (text.length < 3) return { destinations: [], match: 'none' };

  const { tenantSlug = null, sanitize } = options;
  const clean = (label: string) => (sanitize ? sanitize(label) : label);

  const starter = starterFor(text);
  if (starter) {
    const destinations = dedupe(forTenant(starter.destinations, tenantSlug)).filter((d) =>
      isReadOnlySafeHref(d.href),
    );
    if (destinations.length) return { destinations, match: 'starter' };
  }

  const ranked = GUIDE_QUESTIONS.map((q) => ({ q, s: score(q, text) }))
    .filter((r) => r.s >= MIN_TOPIC_SCORE)
    .sort((a, b) => b.s - a.s);
  if (ranked.length) {
    const destinations = dedupe(forTenant(ranked[0].q.destinations, tenantSlug)).filter((d) =>
      isReadOnlySafeHref(d.href),
    );
    if (destinations.length) return { destinations, match: 'topic' };
  }

  // Reuse the console's existing route index rather than inventing a second one. Its labels are
  // written for operators and some of them name an engine, so they go through the sanitiser the
  // caller supplies (`publicLabel`) before a visitor reads them.
  const indexed = matchFeatures(text, 3)
    .filter((f) => isReadOnlySafeHref(f.href))
    .map<GuideDestination>((f) => ({
      label: clean(f.title),
      href: f.href,
      what: `In ${clean(f.subtitle)}.`,
    }));
  if (indexed.length) return { destinations: dedupe(indexed), match: 'index' };

  return { destinations: [], match: 'none' };
}

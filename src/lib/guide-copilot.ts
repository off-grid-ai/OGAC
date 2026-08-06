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
      'prompt',
      'paste',
      'types in',
      'enters',
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
      // The app's own home is the strongest single screen in the product for a non-technical reader:
      // what is waiting, what the AI recommended for each case, what a person already decided, and the
      // plain-language chain on each finished one ("read 2 sources · passed a safety check · AI assessed
      // it · a person decided · signed and tamper-evident"). Verified populated on both tenants today —
      // bank: 11 waiting with real ₹ amounts; insurer: 3 waiting plus a handled history.
      {
        label: 'Open one and see it working',
        href: '/solutions/apps/bhapp_reimb',
        what: 'Eleven reimbursement cases waiting for a person, each with the amount, what the AI found and what it recommends — plus the ones already decided.',
        tenants: [BANK],
      },
      {
        label: 'Open one and see it working',
        href: '/solutions/apps/app_14940314',
        what: 'Death-claim cases waiting for a person, each with what the AI found — plus the ones already decided, and what each decision was checked against.',
        tenants: [INSURER],
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
 * The destinations a question can actually offer THIS tenant: its own tenant's entities, no route a
 * read-only visitor would be refused on, and no href twice. One rule, one place — the starter list and
 * both resolution paths all go through here so they cannot drift apart.
 */
function offerable(
  question: GuideQuestion,
  tenantSlug: string | null | undefined,
): GuideDestination[] {
  return dedupe(forTenant(question.destinations, tenantSlug)).filter((d) =>
    isReadOnlySafeHref(d.href),
  );
}

/**
 * The starter questions to show this tenant, with tenant-specific destinations already filtered out.
 * A question whose every destination is another tenant's is dropped rather than shown dead — there
 * is currently no such question, and the test asserts that stays true.
 */
export function guideQuestionsForTenant(tenantSlug: string | null | undefined): GuideQuestion[] {
  return GUIDE_QUESTIONS.map((q) => ({ ...q, destinations: offerable(q, tenantSlug) })).filter(
    (q) => q.destinations.length > 0,
  );
}

const WORD_RE = /[a-z0-9]+/g;

/** Normalised word set of a string — the shared tokenisation both scoring paths use. */
function words(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

/**
 * Whole-word match, tolerant of a naive plural only. Substring matching is what makes a keyword index
 * feel like it is guessing — "run" should not match "Run & schedule backups" — so a term has to line
 * up with a whole word. The plural tolerance exists because a visitor writes "someone pastes a PAN"
 * where the table says "paste".
 */
function hasWord(set: ReadonlySet<string>, term: string): boolean {
  if (set.has(term)) return true;
  if (set.has(`${term}s`)) return true;
  return term.endsWith('s') && set.has(term.slice(0, -1));
}

/**
 * Score a question against free text: how many of its terms the text contains. A multi-word keyword
 * must appear as a phrase and counts double (a phrase is a much stronger signal than a word).
 */
function score(question: GuideQuestion, text: string): number {
  const lower = ` ${text.toLowerCase()} `;
  const set = new Set(words(text));
  let hits = 0;
  for (const term of [...question.keywords, question.question]) {
    const t = term.toLowerCase();
    if (t.includes(' ')) {
      if (lower.includes(t)) hits += 2;
    } else if (hasWord(set, t)) {
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
/**
 * Is this destination the screen the reader is already on?
 *
 * Compares the PATH only — a destination may carry a query string, and `/insights/cost?tab=models`
 * from `/insights/cost` is still a real move. Trailing slashes are normalised because a route can be
 * written either way and a false negative here puts a dead link back on screen.
 */
export function isCurrentPath(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const strip = (v: string) => (v.split('?')[0].replace(/\/+$/, '') || '/');
  return strip(href) === strip(pathname);
}

/**
 * Drop destinations that point at the current screen.
 *
 * A "go and see it" link to the page you are already reading does nothing when you click it. There is
 * no way to distinguish that from a broken product: the reader clicks, the screen does not change,
 * and they stop trusting every other link on the surface. Handling the click gracefully is not
 * enough — the link should never have been offered.
 */
export function withoutCurrentPage(
  resolution: GuideResolution,
  pathname: string | null | undefined,
): GuideResolution {
  const destinations = resolution.destinations.filter((d) => !isCurrentPath(d.href, pathname));
  if (destinations.length === resolution.destinations.length) return resolution;
  // Everything it had to offer was this page. That is 'none' — there is nowhere to send the reader,
  // and saying so is honest, where an empty list under a "Go and see it" heading just looks broken.
  return { ...resolution, destinations, match: destinations.length ? resolution.match : 'none' };
}

export function resolveGuideDestinations(
  question: string,
  options: { tenantSlug?: string | null; sanitize?: (label: string) => string } = {},
): GuideResolution {
  const text = question.trim();
  if (text.length < 3) return { destinations: [], match: 'none' };

  const { tenantSlug = null, sanitize } = options;
  const clean = (label: string) => (sanitize ? sanitize(label) : label);

  const starter = starterFor(text);
  const ranked = GUIDE_QUESTIONS.map((q) => ({ q, s: score(q, text) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);
  const best = ranked[0];

  // A clicked chip is the strongest possible signal; otherwise the best-scoring question, if it
  // scored well enough to be more than a coincidence.
  const curated: { q: GuideQuestion; match: GuideMatch } | null = starter
    ? { q: starter, match: 'starter' }
    : best && best.s >= MIN_TOPIC_SCORE
      ? { q: best.q, match: 'topic' }
      : null;
  if (curated) {
    const destinations = offerable(curated.q, tenantSlug);
    if (destinations.length) return { destinations, match: curated.match };
  }

  // A query the curated table HALF recognised (one weak hit, below the threshold) stops here.
  // "run" is the case that showed why: it scores 1 against several questions and, left to fall
  // through, the keyword index sent it to "Run & schedule backups" — a confident-looking answer to a
  // question nobody asked. Guessing from a keyword index on top of an already-weak signal is a guess
  // on a guess, and this audience reads a wrong destination as a broken product. Only a query the
  // table knows NOTHING about (score 0) is worth a "closest match".
  if (best) return { destinations: [], match: 'none' };

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

// ─── Who is reading this? ────────────────────────────────────────────────────────────────────────
//
// The same console answers four different jobs, and they do not want the same evidence first. A CISO
// opens with "what stops a bad thing"; a DPO only cares about personal data; a CIO is costing an
// operational commitment; an investor wants to know it is real before anything else.
//
// HOW WE ASK. Not with a gate. A role picker in front of the panel is a form before any value, and
// the people these links go to are exactly the ones who close the tab rather than fill one in — and
// a reader who has seen nothing yet does not know why we are asking. So: the demo LINK can carry it
// (`?as=ciso`, set by whoever sends the link, who already knows), and inside the panel it is one
// skippable row with the full list underneath it either way.
//
// THE RULE THAT KEEPS THIS HONEST: a role changes which facts LEAD, never which facts exist. Every
// question stays reachable for everyone. A tour that hides things from some readers is a pitch, and
// this surface exists to be the opposite of that.
export type GuideRole = 'ciso' | 'dpo' | 'cio' | 'investor';

export interface GuideRoleSpec {
  id: GuideRole;
  /** How the reader would name themselves. */
  label: string;
  /** One line, in their language, shown once the role is chosen. */
  opening: string;
  /** Themes in the order this role cares about them. Every theme appears — only the order changes. */
  themeOrder: readonly GuideThemeId[];
}

export const GUIDE_ROLES: readonly GuideRoleSpec[] = [
  {
    id: 'ciso',
    label: 'Security',
    opening: 'Starting with what gets stopped, who can reach what, and what leaves the network.',
    themeOrder: ['trust', 'private', 'works', 'value'],
  },
  {
    id: 'dpo',
    label: 'Privacy',
    opening: 'Starting with personal data — where it lives, what gets masked, and who touched it.',
    themeOrder: ['private', 'trust', 'works', 'value'],
  },
  {
    id: 'cio',
    label: 'IT / Platform',
    opening: 'Starting with what it costs to run, what it plugs into, and who operates it.',
    themeOrder: ['value', 'works', 'private', 'trust'],
  },
  {
    id: 'investor',
    label: 'Investor',
    opening: 'Starting with whether this is real software doing real work, and what it returns.',
    themeOrder: ['works', 'value', 'trust', 'private'],
  },
];

/** Read a role off a URL parameter. Unknown or absent → null; we never guess a reader's job. */
export function guideRoleFromParam(raw: string | null | undefined): GuideRole | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return GUIDE_ROLES.some((r) => r.id === v) ? (v as GuideRole) : null;
}

export function guideRoleSpec(role: GuideRole | null | undefined): GuideRoleSpec | null {
  return GUIDE_ROLES.find((r) => r.id === role) ?? null;
}

/**
 * Themes in the order this reader cares about them.
 *
 * Returns EVERY theme, reordered — never a subset. Dropping a theme for a role would mean a CISO
 * could not find the cost story at all, which is both wrong about CISOs and dishonest about the
 * product.
 */
export function themesForRole(role: GuideRole | null | undefined): GuideTheme[] {
  const spec = guideRoleSpec(role);
  if (!spec) return [...GUIDE_THEMES];
  const rank = new Map(spec.themeOrder.map((id, i) => [id, i]));
  return [...GUIDE_THEMES].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

// ─── What to ask next ────────────────────────────────────────────────────────────────────────────
//
// After an answer, a fixed list of eleven starters is the wrong thing to show: the reader has just
// been told something, and the useful next question follows from THAT.
//
// COMPUTED, NOT GENERATED. Asking the model for follow-ups costs another several seconds and can
// invent a question this product cannot answer — which dead-ends the reader on their second click,
// the worst possible moment. The answer already tells us what it touched (the destinations it
// resolved to), and the curated graph knows which other questions lead to the same screens. So the
// next questions are the neighbours of where we just were, minus anything already asked.

/** Route paths a resolution pointed at, normalised for comparison. */
function destinationPaths(resolution: GuideResolution): Set<string> {
  return new Set(resolution.destinations.map((d) => d.href.split('?')[0].replace(/\/+$/, '')));
}

/**
 * The questions worth asking next, given where the last answer took the reader.
 *
 * Neighbours first (a question that shares a destination with the answer just given is a continuation
 * of the same thread), then the rest of that theme, so the list is never empty and never repeats.
 */
export function followUpQuestions(
  questions: readonly GuideQuestion[],
  resolution: GuideResolution | null,
  askedQuestions: readonly string[],
  limit = 4,
): GuideQuestion[] {
  const asked = new Set(askedQuestions.map((q) => q.trim().toLowerCase()));
  const fresh = questions.filter((q) => !asked.has(q.question.trim().toLowerCase()));
  if (!resolution || resolution.destinations.length === 0) return fresh.slice(0, limit);

  const paths = destinationPaths(resolution);
  const themes = new Set(
    questions
      .filter((q) => q.destinations.some((d) => paths.has(d.href.split('?')[0].replace(/\/+$/, ''))))
      .map((q) => q.theme),
  );
  const score = (q: GuideQuestion): number => {
    const shares = q.destinations.some((d) => paths.has(d.href.split('?')[0].replace(/\/+$/, '')));
    if (shares) return 0; // same screens — the direct continuation
    if (themes.has(q.theme)) return 1; // same subject, somewhere new
    return 2;
  };
  return [...fresh].sort((a, b) => score(a) - score(b)).slice(0, limit);
}

// ─── Connector rule engine — the deterministic phrase → data-domain resolver (Builder Epic 1B) ──
//
// THE PROMISE (Builder Epic §3.2, risk #2): the org DECLARES where data lives — "reimbursement
// quota → connector con_hr, table employee_quota"; "invoices → S3 bucket". When a workflow step or
// a query says "check the employee quota", we route to the correct connector BY RULE, never by
// guessing. A wrong binding silently reads the WRONG system, so this resolver is:
//
//   • DETERMINISTIC — same phrase + same domains ⇒ same result, always. No randomness, no model.
//   • NO-GUESS — returns null the moment nothing confidently matches. A miss is safe (the caller
//     records nothing / falls back); a wrong bind is a data-integrity incident. We never "pick the
//     closest" on a weak signal.
//   • PURE — zero I/O, zero imports. Unit-testable in isolation. All the correctness lives here.
//
// Matching precedence (strongest → weakest signal), first tier that yields a UNIQUE winner wins:
//   1. exact label match           (normalized)         — score 1.0
//   2. exact alias match           (normalized)         — score 0.95
//   3. full phrase ⊆ label/alias   (substring, either direction) — score 0.6–0.85
//   4. token-set containment       (all query tokens present in a label/alias's tokens) — 0.3–0.6
// Tiers 3–4 only win if a single domain reaches the top score by a clear margin; on a tie the
// resolver returns null (ambiguous ⇒ no-guess). Tiers 1–2 break ties stably by id so an exact
// match is never suppressed by a duplicate.

// The pure view of a data-domain row (maps schema.ts `dataDomains`). No DB types here.
export interface DataDomain {
  id: string;
  orgId: string;
  label: string;
  aliases: string[];
  connectorId: string;
  resource: string;
  opHints?: Record<string, unknown>;
}

export interface RankedDomain {
  domain: DataDomain;
  score: number;
}

// The minimum score at which a *fuzzy* (tier 3/4) match is allowed to bind. Below this we treat the
// signal as too weak and return null. Exact label/alias matches (tiers 1–2) are always above it.
const MIN_CONFIDENT_SCORE = 0.3;
// A fuzzy winner must beat the runner-up by at least this margin, else it's ambiguous ⇒ null.
const AMBIGUITY_MARGIN = 0.15;

// ─── normalization (pure) ──────────────────────────────────────────────────────
// Lower-case, collapse whitespace/punctuation, and strip a trailing plural 's' per token so
// "invoices" ≡ "invoice", "employee quotas" ≡ "employee quota". Conservative de-pluralization:
// only a trailing 's'/'es'/'ies' on tokens length ≥ 4 (keeps "hr", "gps", "sms" intact).
function singularize(token: string): string {
  if (token.length >= 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`; // policies → policy
  if (token.length >= 5 && token.endsWith('es') && !token.endsWith('ses')) return token.slice(0, -2); // boxes → box
  if (token.length >= 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1); // invoices → invoice; keep "class"
  return token;
}

function tokenize(phrase: string): string[] {
  const raw = (phrase ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return raw.map(singularize).filter(Boolean);
}

// Normalized form of a whole phrase: singularized tokens joined by single spaces.
function normalize(phrase: string): string {
  return tokenize(phrase).join(' ');
}

// All the surface forms a domain answers to: its label + aliases, each normalized.
function surfaceForms(domain: DataDomain): string[] {
  const forms = [domain.label, ...(domain.aliases ?? [])].map(normalize).filter((s) => s.length > 0);
  return Array.from(new Set(forms)); // de-dupe
}

// ─── scoring one domain against a normalized query (pure) ────────────────────────
// Returns the best tier-score this domain earns for the query, plus the tier (for tie-break intent).
// tier: 1=exact-label, 2=exact-alias, 3=substring, 4=token-containment, 0=no match.
function scoreDomain(
  normQuery: string,
  queryTokens: string[],
  domain: DataDomain,
): { score: number; tier: number } {
  const normLabel = normalize(domain.label);
  const forms = surfaceForms(domain);

  // Tier 1 — exact label match.
  if (normLabel.length > 0 && normLabel === normQuery) return { score: 1.0, tier: 1 };

  // Tier 2 — exact alias match (any surface form equals the query exactly).
  for (const form of forms) {
    if (form !== normLabel && form === normQuery) return { score: 0.95, tier: 2 };
  }

  // Tier 3 — substring containment either direction (phrase ⊆ form, or form ⊆ phrase).
  // Longer overlaps score higher. Guard against trivial 1–2 char hits.
  let best = 0;
  for (const form of forms) {
    if (form.length < 3 || normQuery.length < 3) continue;
    if (normQuery.includes(form) || form.includes(normQuery)) {
      const shorter = Math.min(form.length, normQuery.length);
      const longer = Math.max(form.length, normQuery.length);
      const ratio = shorter / longer; // how much of the larger string is covered
      best = Math.max(best, 0.6 + 0.25 * ratio);
    }
  }
  if (best > 0) return { score: Number(best.toFixed(4)), tier: 3 };

  // Tier 4 — token-set containment: every token of a surface form appears in the query
  // (the query "check the employee quota please" contains all of "employee quota"), OR every
  // query token appears in a form. Scaled by how completely the tokens overlap (Jaccard).
  const qset = new Set(queryTokens);
  for (const form of forms) {
    const fTokens = form.split(' ').filter(Boolean);
    if (fTokens.length === 0) continue;
    const fset = new Set(fTokens);
    const formInQuery = fTokens.every((t) => qset.has(t));
    const queryInForm = queryTokens.length > 0 && queryTokens.every((t) => fset.has(t));
    if (formInQuery || queryInForm) {
      let shared = 0;
      for (const t of fset) if (qset.has(t)) shared += 1;
      const union = new Set([...fset, ...qset]).size;
      const jaccard = union > 0 ? shared / union : 0;
      best = Math.max(best, 0.3 + 0.3 * jaccard);
    }
  }
  if (best > 0) return { score: Number(best.toFixed(4)), tier: 4 };

  return { score: 0, tier: 0 };
}

// ─── resolveDomainRanked — every candidate with a score, best first (deterministic) ─────
// Surfaces candidates for the builder UI. Stable order: score desc, then tier asc (stronger tier
// first), then id asc. Domains that score 0 are omitted.
export function resolveDomainRanked(phrase: string, domains: DataDomain[]): RankedDomain[] {
  const normQuery = normalize(phrase);
  const queryTokens = tokenize(phrase);
  if (normQuery.length === 0) return [];

  const scored = domains
    .map((domain) => {
      const { score, tier } = scoreDomain(normQuery, queryTokens, domain);
      return { domain, score, tier };
    })
    .filter((s) => s.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.domain.id < b.domain.id ? -1 : a.domain.id > b.domain.id ? 1 : 0;
  });

  return scored.map(({ domain, score }) => ({ domain, score }));
}

// ─── resolveDomain — the one binding decision, or null (NEVER guess) ─────────────
// Returns the single domain a phrase confidently binds to, else null. This is the rule the
// connector-query step and the retrieval source call. Safety rules:
//   • exact label/alias winner (tier 1/2) binds even amid other matches — an exact hit is trusted,
//     unless two DISTINCT domains match the phrase exactly on the same tier (genuine ambiguity).
//   • a fuzzy winner (tier 3/4) binds ONLY if its score ≥ MIN_CONFIDENT_SCORE AND it beats the
//     runner-up by ≥ AMBIGUITY_MARGIN. Two near-equal fuzzy candidates ⇒ ambiguous ⇒ null.
//   • empty / no-match ⇒ null.
export function resolveDomain(phrase: string, domains: DataDomain[]): DataDomain | null {
  const ranked = resolveDomainRanked(phrase, domains);
  if (ranked.length === 0) return null;

  const normQuery = normalize(phrase);
  const queryTokens = tokenize(phrase);
  const top = ranked[0];
  const topTier = scoreDomain(normQuery, queryTokens, top.domain).tier;

  // Exact matches (tier 1/2) are trusted outright.
  if (topTier === 1 || topTier === 2) {
    const second = ranked[1];
    if (second?.score === top.score) {
      const secondTier = scoreDomain(normQuery, queryTokens, second.domain).tier;
      if (secondTier === topTier) return null; // two exact matches on the same phrase ⇒ ambiguous
    }
    return top.domain;
  }

  // Fuzzy winner — require confidence AND a clear margin over the runner-up.
  if (top.score < MIN_CONFIDENT_SCORE) return null;
  const runnerUp = ranked[1];
  if (runnerUp && top.score - runnerUp.score < AMBIGUITY_MARGIN) return null;
  return top.domain;
}

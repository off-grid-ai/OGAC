// ─── Data-domain starter-rule proposer (pure) — Builder Epic §3.2 ──────────────────────────────
//
// The founder's framing: the org DECLARES where its data lives — "customer data → Salesforce",
// "transactions → Postgres", "reimbursement quota → HR MySQL", "invoices → S3". This proposer looks
// at the connectors an org ALREADY has and suggests those canonical starter rules — but ONLY when a
// matching connector exists. It NEVER invents a connector: a suggestion always points at a real
// connector id the caller passed in. If the org has no Postgres connector, no "transactions" rule
// is proposed. Zero I/O, fully deterministic → unit-testable.

// The minimal connector shape we match against (a subset of lib/store.ts `Connector`).
export interface SeedConnector {
  id: string;
  name: string;
  type: string;
}

// A proposed starter rule. Same shape the create form / POST route consumes, plus a `rationale`
// so the UI can explain WHY ("matched your Postgres connector 'Core Bank DB'").
export interface ProposedDomain {
  label: string;
  aliases: string[];
  connectorId: string;
  connectorName: string;
  resource: string;
  rationale: string;
}

// One canonical domain archetype: what to call it, its aliases, the default resource name, and how
// to recognise the connector that should back it (by type keywords and/or name keywords).
interface Archetype {
  key: string;
  label: string;
  aliases: string[];
  resource: string;
  // Any of these substrings appearing (case-insensitively) in the connector's `type` is a match.
  typeKeywords: string[];
  // Any of these substrings in the connector's `name` is a match (secondary signal).
  nameKeywords: string[];
}

const ARCHETYPES: Archetype[] = [
  {
    key: 'customer',
    label: 'customer data',
    aliases: ['customers', 'accounts', 'contacts', 'crm'],
    resource: 'Account',
    typeKeywords: ['salesforce', 'crm', 'hubspot', 'rest', 'http', 'mcp'],
    nameKeywords: ['salesforce', 'crm', 'customer', 'hubspot'],
  },
  {
    key: 'transactions',
    label: 'transactions',
    aliases: ['payments', 'ledger', 'transaction history'],
    resource: 'transactions',
    typeKeywords: ['postgres', 'postgresql', 'pg'],
    nameKeywords: ['transaction', 'ledger', 'payment', 'bank'],
  },
  {
    key: 'quota',
    label: 'reimbursement quota',
    aliases: ['employee quota', 'expense limit', 'quota'],
    resource: 'employee_quota',
    typeKeywords: ['mysql', 'maria'],
    nameKeywords: ['hr', 'quota', 'reimbursement', 'employee'],
  },
  {
    key: 'invoices',
    label: 'invoices',
    aliases: ['billing documents', 'invoice archive', 'invoice'],
    resource: 'invoices/',
    typeKeywords: ['s3', 'seaweed', 'blob', 'bucket', 'object'],
    nameKeywords: ['invoice', 's3', 'bucket', 'archive', 'document'],
  },
];

function includesAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

// Score how well a connector fits an archetype. Type match is the strong signal (2); a name match
// is a weaker corroborating signal (1). 0 = no match → this connector can't back this archetype.
function matchScore(connector: SeedConnector, arch: Archetype): number {
  let score = 0;
  if (includesAny(connector.type ?? '', arch.typeKeywords)) score += 2;
  if (includesAny(connector.name ?? '', arch.nameKeywords)) score += 1;
  return score;
}

// Propose starter rules for the org's connectors. For each archetype we pick the SINGLE
// best-matching connector (highest score, ties broken by connector order for determinism) and, if
// it scored > 0, emit one rule bound to that real connector. Archetypes with no matching connector
// are simply skipped — we never fabricate a binding. `existingLabels` (already-declared domain
// labels, lower-cased) are excluded so "suggest" doesn't re-propose what's already there.
export function proposeStarterDomains(
  connectors: SeedConnector[],
  existingLabels: string[] = [],
): ProposedDomain[] {
  const taken = new Set(existingLabels.map((l) => l.trim().toLowerCase()));
  const out: ProposedDomain[] = [];

  for (const arch of ARCHETYPES) {
    if (taken.has(arch.label.toLowerCase())) continue;

    let best: SeedConnector | null = null;
    let bestScore = 0;
    for (const c of connectors) {
      const s = matchScore(c, arch);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best || bestScore === 0) continue;

    out.push({
      label: arch.label,
      aliases: arch.aliases,
      connectorId: best.id,
      connectorName: best.name,
      resource: arch.resource,
      rationale: `Matched your "${best.name}" connector (${best.type}).`,
    });
  }

  return out;
}

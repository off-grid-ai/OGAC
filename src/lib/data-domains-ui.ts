// ─── Data-domains management-surface logic (pure) — Builder Epic §3.2 connector rule engine ──
//
// The pure, zero-I/O helpers behind the data-domains CRUD UI: parse the comma/newline alias input
// into a clean string[], validate a domain form before we ever hit the store, and derive the
// human-readable connector label a card shows. Isolated here (SOLID) so the route handlers and the
// React panels stay thin and the rules are unit-testable without a DB or a router.
//
// The resolver itself (phrase → domain) lives in data-domains.ts; this file is only the *input*
// side — turning operator keystrokes into a valid CreateDomainInput/UpdateDomainInput.

// ─── alias parsing ───────────────────────────────────────────────────────────────
// Operators type aliases free-form: "customers, accounts" or one per line. Split on commas AND
// newlines, trim, drop empties, and de-dupe (case-insensitively, keeping the first spelling) so a
// domain never carries "Accounts" and "accounts" as two rules.
export function parseAliases(raw: string): string[] {
  const parts = (raw ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// The inverse — render a domain's aliases back into the textarea's comma-joined form for editing.
export function formatAliases(aliases: string[] | undefined): string {
  return (aliases ?? []).join(', ');
}

// ─── form validation ─────────────────────────────────────────────────────────────
export interface DomainFormValues {
  label: string;
  connectorId: string;
  resource: string;
  aliasesRaw: string;
}

export interface DomainFormResult {
  ok: boolean;
  errors: Partial<Record<'label' | 'connectorId' | 'resource', string>>;
  // The clean payload — only present when ok. Ready to POST/PATCH.
  value?: { label: string; connectorId: string; resource: string; aliases: string[] };
}

// Validate + normalize a domain form. Every field a binding needs to be unambiguous is required:
// a label (what the phrase resolves to), a connector (WHERE), and a resource (the table/path/object
// within it). A domain with no connector or no resource can't route a query, so we reject it up
// front rather than persisting a dead rule.
export function validateDomainForm(v: DomainFormValues): DomainFormResult {
  const errors: DomainFormResult['errors'] = {};
  const label = (v.label ?? '').trim();
  const connectorId = (v.connectorId ?? '').trim();
  const resource = (v.resource ?? '').trim();

  if (!label) errors.label = 'A label is required (e.g. "customer data").';
  else if (label.length > 120) errors.label = 'Label is too long (max 120 chars).';

  if (!connectorId) errors.connectorId = 'Pick the connector this data lives in.';

  if (!resource) errors.resource = 'Name the table / path / object within the connector.';
  else if (resource.length > 200) errors.resource = 'Resource is too long (max 200 chars).';

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok ? { label, connectorId, resource, aliases: parseAliases(v.aliasesRaw) } : undefined,
  };
}

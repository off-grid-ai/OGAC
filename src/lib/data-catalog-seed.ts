// ─── M4 data governance — the PURE catalog-seed proposer (zero-I/O, unit-testable) ─────────────
//
// "What data do I have" starts from what the org already declared: its connectors (WHERE data comes
// from) and its data-domains (WHICH data lives where). This proposer turns those real, existing
// entities into proposed catalog ASSETS — never fabricating a source. A domain (label → connector +
// resource) is the strongest signal; a bare connector with no domain still gets one placeholder
// asset so nothing the org connected is invisible. Deterministic → testable.

// Minimal shapes we read (subsets of the real Connector / DataDomain views).
export interface SeedConnector {
  id: string;
  name: string;
  type: string;
}
export interface SeedDomain {
  id: string;
  label: string;
  connectorId: string;
  resource: string;
}

// A proposed catalog asset — the same shape the create form / POST route consumes, plus a rationale.
export interface ProposedAsset {
  name: string;
  source: string;
  connectorId: string | null;
  domainId: string | null;
  kind: string;
  rationale: string;
}

// Guess an asset `kind` from a connector type (object stores → file; streams → stream; else table).
function kindForType(type: string): string {
  const t = (type ?? '').toLowerCase();
  if (/(s3|seaweed|blob|bucket|object|file)/.test(t)) return 'file';
  if (/(kafka|stream|kinesis|pubsub)/.test(t)) return 'stream';
  if (/(qdrant|vector|weaviate|pinecone)/.test(t)) return 'collection';
  return 'table';
}

// Propose catalog assets from the org's connectors + declared domains. `existingNames` (lower-cased)
// are skipped so re-seeding doesn't duplicate. For each domain → one asset bound to its connector +
// resource. For a connector with NO domain → one placeholder asset so it's still catalogued.
export function proposeCatalogAssets(
  connectors: readonly SeedConnector[],
  domains: readonly SeedDomain[],
  existingNames: readonly string[] = [],
): ProposedAsset[] {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const byId = new Map(connectors.map((c) => [c.id, c]));
  const out: ProposedAsset[] = [];
  const emit = (a: ProposedAsset) => {
    const key = a.name.trim().toLowerCase();
    if (!a.name.trim() || taken.has(key)) return;
    taken.add(key);
    out.push(a);
  };

  // Domain-derived assets (strongest signal).
  const connectorsWithDomain = new Set<string>();
  for (const d of domains) {
    const c = byId.get(d.connectorId);
    connectorsWithDomain.add(d.connectorId);
    const source = c ? `${c.name} (${c.type})` : d.connectorId;
    emit({
      name: `${d.label} — ${d.resource}`,
      source,
      connectorId: d.connectorId,
      domainId: d.id,
      kind: c ? kindForType(c.type) : 'table',
      rationale: `Declared data-domain "${d.label}" → ${d.resource}.`,
    });
  }

  // Connectors with no domain → one placeholder asset so nothing connected is invisible.
  for (const c of connectors) {
    if (connectorsWithDomain.has(c.id)) continue;
    emit({
      name: `${c.name} dataset`,
      source: `${c.name} (${c.type})`,
      connectorId: c.id,
      domainId: null,
      kind: kindForType(c.type),
      rationale: `Connector "${c.name}" has no declared data-domain yet — placeholder asset.`,
    });
  }

  return out;
}

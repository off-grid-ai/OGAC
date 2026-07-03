// Provenance read-back — the DISPLAY layer for the signed-provenance surface (Phase 4).
//
// Two seams, deliberately split (SOLID):
//   1. `buildProvenanceView` — a PURE normalizer. ZERO imports, so it's unit-testable in isolation
//      (mirror of tenancy-policy.ts). Given raw provenance records it produces the display model:
//      verified/unverified rollup + per-record rows, newest-first. It NEVER throws — malformed,
//      missing, or empty input degrades gracefully.
//   2. `readProvenanceView` — a thin, best-effort reader that pulls recent signed records off the
//      existing provenance module (agent-run signatures verified with the active signing port) and
//      feeds them through the normalizer. All I/O lives here; the rule lives above.

// A raw provenance record as it arrives from the reader (or a test). Every field is treated as
// untrusted — the normalizer copes with anything.
export interface ProvenanceRecord {
  subject?: unknown; // what was signed (e.g. an agent-run id or filename)
  signer?: unknown; // identity / algorithm that produced the signature
  sha256?: unknown; // hex digest of the signed content, if known
  verified?: unknown; // did the signature verify against the active key?
  timestamp?: unknown; // ISO-8601 signing time
}

// A normalized row ready to render — every field is a safe, typed primitive.
export interface ProvenanceRow {
  subject: string;
  signer: string;
  sha256Short: string; // first 12 hex chars, or '—'
  verified: boolean;
  timestamp: string; // ISO-8601 or '' when unknown/unparseable
}

export interface ProvenanceView {
  total: number;
  verified: number;
  unverified: number;
  records: ProvenanceRow[]; // newest-first
}

const EMPTY: ProvenanceView = { total: 0, verified: 0, unverified: 0, records: [] };

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

// Normalize a sha256 to a short display form. Accepts full/partial hex; anything else → '—'.
function shortSha(v: unknown): string {
  if (typeof v !== 'string') return '—';
  const hex = v.trim().replace(/^sha256:/i, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return '—';
  return hex.slice(0, 12).toLowerCase();
}

// Coerce to a stable ISO string, or '' if unparseable. Used both for the row and for sorting.
function isoTime(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = Date.parse(v);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

function normalizeRow(r: ProvenanceRecord): ProvenanceRow {
  return {
    subject: str(r?.subject, '(unknown)'),
    signer: str(r?.signer, '(unsigned)'),
    sha256Short: shortSha(r?.sha256),
    verified: r?.verified === true,
    timestamp: isoTime(r?.timestamp),
  };
}

/**
 * PURE. Build the display model from raw provenance records. Never throws.
 * Rows are sorted newest-first (unknown timestamps sort last). Non-array / nullish input → empty.
 */
export function buildProvenanceView(records: readonly ProvenanceRecord[] | null | undefined): ProvenanceView {
  if (!Array.isArray(records) || records.length === 0) return EMPTY;

  const rows = records
    .filter((r): r is ProvenanceRecord => r != null && typeof r === 'object')
    .map(normalizeRow)
    .sort((a, b) => {
      // Newest-first; empty timestamps (unknown) sink to the bottom.
      if (a.timestamp === b.timestamp) return 0;
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return a.timestamp < b.timestamp ? 1 : -1;
    });

  const verified = rows.filter((r) => r.verified).length;
  return { total: rows.length, verified, unverified: rows.length - verified, records: rows };
}

// ── Reader (I/O) ──────────────────────────────────────────────────────────────────────────────
// Best-effort: pulls recent agent-run signatures — the console's live source of signed provenance —
// re-verifies each against the active signing port, and returns the display model. Never throws;
// on any failure it returns the empty view so the page always renders.
export async function readProvenanceView(limit = 50, orgId?: string): Promise<ProvenanceView> {
  try {
    const [{ listAgentRuns }, { getSigning }] = await Promise.all([
      import('@/lib/agentrun'),
      import('@/lib/adapters/registry'),
    ]);
    const signing = getSigning();
    const runs = await listAgentRuns(limit, orgId);

    const records: ProvenanceRecord[] = runs
      .filter((r) => r.provenance != null)
      .map((r) => {
        const p = r.provenance!;
        // Reconstruct the exact payload agentrun signs, then re-verify with the active key.
        const payload = { agentId: r.agentId, query: r.query, answer: r.answer, refs: r.citations.map((c) => c.ref) };
        let verified = false;
        try {
          verified = signing.verify(payload, p.signature);
        } catch {
          verified = false;
        }
        return {
          subject: `${r.agentId} · ${r.id}`,
          signer: p.publicKey ? `${p.algorithm} · ${p.publicKey.slice(0, 16)}…` : p.algorithm,
          sha256: p.signature.replace(/^sig_/, ''),
          verified,
          timestamp: p.signedAt,
        };
      });

    return buildProvenanceView(records);
  } catch {
    return EMPTY;
  }
}
